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

    def get_mac_hosts(self, rule_name: str = "") -> list:
        root = self._request("<Get><MACHost></MACHost></Get>")
        enabled_names: set = set()
        if rule_name:
            try:
                enabled_names = set(self.get_rule_networks(rule_name))
            except Exception:
                pass
        hosts = []
        for h in root.findall(".//MACHost"):
            mac_type = h.findtext("Type", "")
            if mac_type not in ("MACAddress", "MACLIST"):
                continue
            name = h.findtext("Name", "")
            description = h.findtext("Description", "")
            if mac_type == "MACAddress":
                mac_address = h.findtext("MACAddress", "")
                mac_addresses = []
            else:
                maclist_el = h.find("MACList")
                if maclist_el is not None:
                    mac_addresses = [m.text for m in maclist_el.findall("MACAddress") if m.text]
                else:
                    mac_addresses = []
                mac_address = mac_addresses[0] if mac_addresses else ""
            hosts.append({
                "name": name,
                "mac_type": mac_type,
                "mac_address": mac_address,
                "mac_addresses": mac_addresses,
                "description": description,
                "is_enabled": name in enabled_names,
            })
        return hosts

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

    # ── IP Host ───────────────────────────────────────────────────────────────

    def add_ip_host(self, name: str, ip_type: str, ip_value: str, description: str = "") -> None:
        n = saxutils.escape(name)
        d = saxutils.escape(description)

        if ip_type == "IP":
            body = (
                f"<Name>{n}</Name>"
                "<IPFamily>IPv4</IPFamily>"
                "<HostType>IP</HostType>"
                f"<IPAddress>{saxutils.escape(ip_value)}</IPAddress>"
                f"<Description>{d}</Description>"
            )
        elif ip_type == "IPRange":
            start, _, end = ip_value.partition("-")
            body = (
                f"<Name>{n}</Name>"
                "<IPFamily>IPv4</IPFamily>"
                "<HostType>IPRange</HostType>"
                f"<StartIPAddress>{saxutils.escape(start.strip())}</StartIPAddress>"
                f"<EndIPAddress>{saxutils.escape(end.strip())}</EndIPAddress>"
                f"<Description>{d}</Description>"
            )
        elif ip_type == "IPList":
            ips = [ip.strip() for ip in ip_value.split(",") if ip.strip()]
            ip_entries = "".join(f"<IPAddress>{saxutils.escape(ip)}</IPAddress>" for ip in ips)
            body = (
                f"<Name>{n}</Name>"
                "<IPFamily>IPv4</IPFamily>"
                "<HostType>IPList</HostType>"
                f"<IPList>{ip_entries}</IPList>"
                f"<Description>{d}</Description>"
            )
        else:
            raise ValueError(f"Unknown ip_type: {ip_type}")

        xml = f'<Set operation="add"><IPHost>{body}</IPHost></Set>'
        root = self._request(xml)
        ok, msg = self._check_status(root, "IPHost")
        if not ok:
            raise RuntimeError(f"Add IP host failed: {msg}")

    def ip_host_exists(self, name: str) -> bool:
        n = saxutils.escape(name)
        xml = (
            "<Get><IPHost>"
            f"<Filter><key name=\"Name\" criteria=\"=\">{n}</key></Filter>"
            "</IPHost></Get>"
        )
        root = self._request(xml)
        return root.find(".//IPHost/Name") is not None

    def remove_ip_host(self, name: str) -> None:
        n = saxutils.escape(name)
        xml = f"<Remove><IPHost><Name>{n}</Name></IPHost></Remove>"
        root = self._request(xml)
        ok, msg = self._check_status(root, "IPHost")
        if not ok:
            raise RuntimeError(f"Remove IP host failed: {msg}")

    def update_ip_host(self, old_name: str, new_name: str, ip_type: str, ip_value: str, description: str = "") -> None:
        self.remove_ip_host(old_name)
        self.add_ip_host(new_name, ip_type, ip_value, description)

    def get_ip_hosts(self, rule_name: str = "") -> list:
        root = self._request("<Get><IPHost></IPHost></Get>")
        enabled_names: set = set()
        if rule_name:
            try:
                enabled_names = set(self.get_rule_networks(rule_name))
            except Exception:
                pass
        hosts = []
        for h in root.findall(".//IPHost"):
            host_type = h.findtext("HostType", "")
            if host_type not in ("IP", "IPRange", "IPList"):
                continue
            name = h.findtext("Name", "")
            description = h.findtext("Description", "")
            if host_type == "IP":
                ip_value = h.findtext("IPAddress", "")
            elif host_type == "IPRange":
                start = h.findtext("StartIPAddress", "")
                end = h.findtext("EndIPAddress", "")
                ip_value = f"{start}-{end}"
            else:
                iplist_el = h.find("IPList")
                if iplist_el is not None:
                    ips = [n.text for n in iplist_el.findall("IPAddress") if n.text]
                else:
                    raw = h.findtext("ListOfIPAddresses", "")
                    if raw:
                        ips = [ip.strip() for ip in raw.split(",") if ip.strip()]
                    else:
                        ips = [n.text for n in h.findall(".//IPAddress") if n.text]
                ip_value = ", ".join(ips)
            hosts.append({
                "name": name,
                "ip_type": host_type,
                "ip_value": ip_value,
                "description": description,
                "is_enabled": name in enabled_names,
            })
        return hosts

    # ── Firewall Users ────────────────────────────────────────────────────────

    def get_firewall_user(self, username: str) -> dict | None:
        n = saxutils.escape(username)
        xml = (
            "<Get><User>"
            f"<Filter><key name=\"Username\" criteria=\"=\">{n}</key></Filter>"
            "</User></Get>"
        )
        root = self._request(xml, timeout=15)
        u = root.find(".//User")
        if u is None:
            return None
        email_node = u.find(".//EmailList/EmailID")
        return {
            "username": u.findtext("Username", ""),
            "name": u.findtext("Name", ""),
            "email": email_node.text.strip() if email_node is not None and email_node.text else "",
            "group": u.findtext("Group", ""),
            "status": u.findtext("Status", "Active"),
            "description": u.findtext("Description", ""),
        }

    def get_firewall_users(self) -> list:
        root = self._request("<Get><User></User></Get>", timeout=60)
        users = []
        for u in root.findall(".//User"):
            email_node = u.find(".//EmailList/EmailID")
            users.append({
                "username": u.findtext("Username", ""),
                "name": u.findtext("Name", ""),
                "email": email_node.text.strip() if email_node is not None and email_node.text else "",
                "group": u.findtext("Group", ""),
                "status": u.findtext("Status", "Active"),
                "description": u.findtext("Description", ""),
            })
        return users

    def get_firewall_groups(self) -> list:
        root = self._request("<Get><UserGroup></UserGroup></Get>")
        return [
            g.findtext("Name", "")
            for g in root.findall(".//GroupDetail")
            if g.findtext("GroupType", "") == "Normal"
        ]

    def add_firewall_user(self, username: str, name: str, password: str,
                          email: str, group: str, description: str = "",
                          status: str = "Active") -> None:
        xml = (
            '<Set operation="add"><User>'
            f"<Username>{saxutils.escape(username)}</Username>"
            f"<Name>{saxutils.escape(name)}</Name>"
            f"<Password>{saxutils.escape(password)}</Password>"
            f"<Description>{saxutils.escape(description)}</Description>"
            "<UserType>User</UserType>"
            f"<EmailList><EmailID>{saxutils.escape(email)}</EmailID></EmailList>"
            f"<Group>{saxutils.escape(group)}</Group>"
            f"<Status>{saxutils.escape(status)}</Status>"
            "<IsEncryptedPassword>0</IsEncryptedPassword>"
            "</User></Set>"
        )
        root = self._request(xml)
        ok, msg = self._check_status(root, "User")
        if not ok:
            raise RuntimeError(f"Add firewall user failed: {msg}")

    def update_firewall_user(self, username: str, name: str, email: str,
                             group: str, description: str = "",
                             status: str = "Active", password: str = "") -> None:
        body = (
            f"<Username>{saxutils.escape(username)}</Username>"
            f"<Name>{saxutils.escape(name)}</Name>"
            f"<Description>{saxutils.escape(description)}</Description>"
            "<UserType>User</UserType>"
            f"<EmailList><EmailID>{saxutils.escape(email)}</EmailID></EmailList>"
            f"<Group>{saxutils.escape(group)}</Group>"
            f"<Status>{saxutils.escape(status)}</Status>"
        )
        if password:
            body += (
                f"<Password>{saxutils.escape(password)}</Password>"
                "<IsEncryptedPassword>0</IsEncryptedPassword>"
            )
        xml = f'<Set operation="update"><User>{body}</User></Set>'
        root = self._request(xml)
        ok, msg = self._check_status(root, "User")
        if not ok:
            raise RuntimeError(f"Update firewall user failed: {msg}")

    def delete_firewall_user(self, username: str) -> None:
        xml = f"<Remove><User><Username>{saxutils.escape(username)}</Username></User></Remove>"
        root = self._request(xml)
        ok, msg = self._check_status(root, "User")
        if not ok:
            raise RuntimeError(f"Delete firewall user failed: {msg}")
