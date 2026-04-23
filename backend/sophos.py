import re
import requests
import xml.etree.ElementTree as ET
import xml.sax.saxutils as saxutils
from typing import List
import urllib3

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)


def normalize_mac(mac: str) -> str:
    cleaned = re.sub(r'[^0-9a-fA-F]', '', mac)
    if len(cleaned) != 12:
        raise ValueError(f"Invalid MAC address: {mac}")
    return ':'.join(cleaned[i:i+2].upper() for i in range(0, 12, 2))


def mac_to_host_name(mac: str) -> str:
    return 'NG-' + mac.replace(':', '-')


class SophosAPI:
    def __init__(self, host: str, username: str, password: str, port: int = 4444):
        self.base_url = f"https://{host}:{port}/webconsole/APIController"
        self.username = username
        self.password = password
        self._session = requests.Session()
        self._session.verify = False

    def _request(self, body: str, timeout: int = 30) -> ET.Element:
        xml = (
            "<Request>"
            f"<Login><Username>{self.username}</Username><Password>{self.password}</Password></Login>"
            f"{body}"
            "</Request>"
        )
        resp = self._session.post(self.base_url, data={"reqxml": xml}, timeout=timeout)
        resp.raise_for_status()
        return ET.fromstring(resp.text)

    def _check_status(self, root: ET.Element, entity_tag: str) -> tuple:
        for path in [f".//{entity_tag}/Status", ".//Status"]:
            node = root.find(path)
            if node is not None:
                code = node.get("code", "")
                ok = code in ("200", "202")
                return ok, node.text or f"code={code}"
        raw = ET.tostring(root, encoding="unicode")
        print(f"[sophos] no Status node in response:\n{raw[:800]}")
        return False, "Unexpected response from Sophos"

    # ── MAC Host ──────────────────────────────────────────────────────────────

    def add_mac_host(self, name: str, mac: str, description: str = "") -> None:
        n = saxutils.escape(name)
        d = saxutils.escape(description)
        xml = (
            '<Set operation="add">'
            "<MACHost>"
            f"<Name>{n}</Name>"
            "<Type>MACAddress</Type>"
            f"<MACAddress>{mac}</MACAddress>"
            f"<Description>{d}</Description>"
            "</MACHost>"
            "</Set>"
        )
        root = self._request(xml)
        ok, msg = self._check_status(root, "MACHost")
        if not ok:
            raise RuntimeError(f"Add MAC host failed: {msg}")

    def add_mac_list_host(self, name: str, macs: List[str], description: str = "") -> None:
        n = saxutils.escape(name)
        d = saxutils.escape(description)
        macs_xml = "".join(f"<MACAddress>{mac}</MACAddress>" for mac in macs)
        xml = (
            '<Set operation="add">'
            "<MACHost>"
            f"<Name>{n}</Name>"
            "<Type>MACLIST</Type>"
            f"<MACList>{macs_xml}</MACList>"
            f"<Description>{d}</Description>"
            "</MACHost>"
            "</Set>"
        )
        root = self._request(xml)
        ok, msg = self._check_status(root, "MACHost")
        if not ok:
            raise RuntimeError(f"Add MAC list host failed: {msg}")

    def update_mac_host(self, old_name: str, new_name: str, mac: str, description: str = "", mac_type: str = "MACAddress", macs: List[str] = None) -> None:
        """Rename/update a MAC host: delete old, create new."""
        # Remove from rule first if needed — caller handles that
        self.remove_mac_host(old_name)
        if mac_type == "MACLIST" and macs:
            self.add_mac_list_host(new_name, macs, description)
        else:
            self.add_mac_host(new_name, mac, description)

    def mac_host_exists(self, name: str) -> bool:
        n = saxutils.escape(name)
        xml = (
            "<Get><MACHost>"
            f"<Filter><key name=\"Name\" criteria=\"=\">{n}</key></Filter>"
            "</MACHost></Get>"
        )
        root = self._request(xml)
        return root.find(".//MACHost/Name") is not None

    def remove_mac_host(self, name: str) -> None:
        n = saxutils.escape(name)
        xml = f"<Remove><MACHost><Name>{n}</Name></MACHost></Remove>"
        root = self._request(xml)
        ok, msg = self._check_status(root, "MACHost")
        if not ok:
            raise RuntimeError(f"Remove MAC host failed: {msg}")

    # ── Firewall Rule ─────────────────────────────────────────────────────────

    def _get_full_rule(self, rule_name: str) -> ET.Element:
        """Returns the full <FirewallRule> element for the named rule."""
        xml = (
            "<Get><FirewallRule>"
            f"<Filter><key name=\"Name\" criteria=\"=\">{rule_name}</key></Filter>"
            "</FirewallRule></Get>"
        )
        root = self._request(xml)
        rule = root.find(".//FirewallRule")
        if rule is None:
            raise RuntimeError(f"Firewall rule '{rule_name}' not found")
        return rule

    def get_rule_networks(self, rule_name: str) -> List[str]:
        rule = self._get_full_rule(rule_name)
        return [
            n.text.strip()
            for n in rule.findall(".//SourceNetworks/Network")
            if n.text
        ]

    def _update_rule_source_networks(self, rule_name: str, networks: List[str], rule_el: ET.Element = None) -> None:
        """
        Replace SourceNetworks in the rule and SET it back.
        Sending the complete rule is required — partial updates clear unspecified fields.
        Uses a 120s timeout because Sophos applies the rule change to live traffic.
        Pass rule_el to skip the extra GET when the caller already fetched it.
        """
        if rule_el is None:
            rule_el = self._get_full_rule(rule_name)

        # Strip transactionid — Sophos rejects SET if it doesn't match its internal state
        rule_el.attrib.pop("transactionid", None)

        # Replace SourceNetworks children
        src_nets = rule_el.find(".//NetworkPolicy/SourceNetworks")
        if src_nets is None:
            raise RuntimeError("SourceNetworks element not found in rule")
        for child in list(src_nets):
            src_nets.remove(child)
        for name in networks:
            n = ET.SubElement(src_nets, "Network")
            n.text = name

        # Re-serialise and send — 120s timeout for rule commits
        rule_xml = ET.tostring(rule_el, encoding="unicode")
        body = f'<Set operation="update">{rule_xml}</Set>'
        root = self._request(body, timeout=120)
        ok, msg = self._check_status(root, "FirewallRule")
        if not ok:
            raise RuntimeError(f"Firewall rule update failed: {msg}")

    def add_to_rule(self, rule_name: str, host_name: str) -> None:
        rule_el = self._get_full_rule(rule_name)
        networks = [n.text.strip() for n in rule_el.findall(".//SourceNetworks/Network") if n.text]
        if host_name not in networks:
            networks.append(host_name)
            self._update_rule_source_networks(rule_name, networks, rule_el)

    def remove_from_rule(self, rule_name: str, host_name: str) -> None:
        rule_el = self._get_full_rule(rule_name)
        networks = [n.text.strip() for n in rule_el.findall(".//SourceNetworks/Network") if n.text]
        if host_name in networks:
            networks.remove(host_name)
            self._update_rule_source_networks(rule_name, networks, rule_el)
