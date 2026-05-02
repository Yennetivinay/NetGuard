import os
import json
import traceback
import uuid
from collections import defaultdict
from datetime import datetime, timedelta
from typing import List, Optional

from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, APIRouter, Depends, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, field_validator
from sqlalchemy.orm import Session

from auth import ADMIN_EMAIL, create_jwt, get_user_for_login, hash_password, seed_users_from_env, verify_jwt
from database import ActivityLog, GROUPS, LocalUser, create_tables, get_db
from sophos import SophosAPI, normalize_mac

app = FastAPI(title="NetGuard")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

create_tables()
seed_users_from_env()


# ── Rate limiting ─────────────────────────────────────────────────────────────
_login_attempts: dict = defaultdict(lambda: {"count": 0, "locked_until": None})
MAX_ATTEMPTS = 5
LOCKOUT_MINUTES = 15

def check_rate_limit(ip: str):
    record = _login_attempts[ip]
    if record["locked_until"] and datetime.utcnow() < record["locked_until"]:
        remaining = int((record["locked_until"] - datetime.utcnow()).total_seconds() / 60) + 1
        raise HTTPException(status_code=429, detail=f"Too many failed attempts. Try again in {remaining} minutes.")

def record_failed_attempt(ip: str):
    record = _login_attempts[ip]
    record["count"] += 1
    if record["count"] >= MAX_ATTEMPTS:
        record["locked_until"] = datetime.utcnow() + timedelta(minutes=LOCKOUT_MINUTES)
        record["count"] = 0

def reset_attempts(ip: str):
    _login_attempts[ip] = {"count": 0, "locked_until": None}


# ── Activity logging ───────────────────────────────────────────────────────────
def log_activity(db: Session, user_email: str, action: str, device_name: str = "", details: str = ""):
    db.add(ActivityLog(user_email=user_email, action=action, device_name=device_name, details=details))
    db.commit()


# Two routers — one plain, one under /api — so both path styles work
router = APIRouter()
api_router = APIRouter(prefix="/api")


_sophos_api: Optional[SophosAPI] = None

def sophos() -> SophosAPI:
    global _sophos_api
    if _sophos_api is None:
        _sophos_api = SophosAPI(
            host=os.getenv("SOPHOS_HOST", ""),
            username=os.getenv("SOPHOS_USERNAME", "admin"),
            password=os.getenv("SOPHOS_PASSWORD", ""),
            port=int(os.getenv("SOPHOS_PORT", "4444")),
        )
    return _sophos_api


def firewall_rule() -> str:
    return os.getenv("SOPHOS_FIREWALL_RULE", "#Default_NP_DIRECT_ACCESS")


MAX_SESSIONS = 5

def current_user(request: Request, db: Session = Depends(get_db)) -> dict:
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    user = verify_jwt(auth[7:])
    if not user:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    db_user = db.query(LocalUser).filter(LocalUser.email == user["email"]).first()
    if db_user:
        try:
            sessions = json.loads(db_user.session_id or "[]")
            if not isinstance(sessions, list):
                sessions = []
        except Exception:
            sessions = []
        if sessions and user.get("session_id") not in sessions:
            raise HTTPException(status_code=401, detail="Session expired. Please login again.")
    return user


# ── Auth ──────────────────────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    email: str
    password: str


def _login(data: LoginRequest, request: Request, db: Session = Depends(get_db)):
    ip = request.client.host
    check_rate_limit(ip)
    user = get_user_for_login(data.email, data.password)
    if not user:
        record_failed_attempt(ip)
        log_activity(db, data.email, "LOGIN_FAILED", details=f"Failed login from {ip}")
        raise HTTPException(status_code=401, detail="Invalid email or password")
    reset_attempts(ip)
    db_user = db.query(LocalUser).filter(LocalUser.email == user["email"]).first()
    permissions = db_user.permissions if db_user else "{}"
    session_id = str(uuid.uuid4())
    if db_user:
        try:
            sessions = json.loads(db_user.session_id or "[]")
            if not isinstance(sessions, list):
                sessions = []
        except Exception:
            sessions = []
        sessions.append(session_id)
        if len(sessions) > MAX_SESSIONS:
            sessions = sessions[-MAX_SESSIONS:]  # evict oldest
        db_user.session_id = json.dumps(sessions)
        db.commit()
    token = create_jwt({
        "email": user["email"],
        "name": user["email"].split("@")[0],
        "role": user["role"],
        "permissions": permissions,
        "session_id": session_id,
    })
    log_activity(db, user["email"], "LOGIN", details=f"Logged in from {ip}")
    return {"token": token}


router.post("/auth/login")(_login)
api_router.post("/auth/login")(_login)


@router.get("/auth/me")
def me(user=Depends(current_user)):
    return user


def require_admin(user=Depends(current_user)):
    if user.get("role") not in ("admin", "superadmin"):
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


def require_superadmin(user=Depends(current_user)):
    if user.get("role") != "superadmin":
        raise HTTPException(status_code=403, detail="Superadmin access required")
    return user


def require_section(section: str, level: str = "toggle"):
    def dep(user: dict = Depends(current_user)):
        role = user.get("role", "")
        if role in ("superadmin", "admin"):
            return user
        try:
            perms = json.loads(user.get("permissions", "{}"))
        except Exception:
            perms = {}
        perm = perms.get(section, "none")
        if level == "toggle" and perm in ("toggle", "full"):
            return user
        if level == "full" and perm == "full":
            return user
        raise HTTPException(status_code=403, detail=f"You don't have {level} access to {section}")
    return dep


# ── User Management (admin only) ──────────────────────────────────────────────

class UserCreate(BaseModel):
    email: str
    password: str
    role: str = "user"
    permissions: str = "{}"


class UserOut(BaseModel):
    id: int
    email: str
    role: str
    permissions: str
    created_at: datetime

    class Config:
        from_attributes = True


class UserUpdate(BaseModel):
    role: str = "user"
    permissions: str = "{}"


def _list_users(db: Session = Depends(get_db), _=Depends(require_admin)):
    return db.query(LocalUser).order_by(LocalUser.created_at).all()


def _create_user(data: UserCreate, db: Session = Depends(get_db), admin=Depends(require_admin)):
    if db.query(LocalUser).filter(LocalUser.email == data.email).first():
        raise HTTPException(status_code=409, detail="Email already exists")
    if data.role == "admin" and admin.get("role") != "superadmin":
        raise HTTPException(status_code=403, detail="Only superadmin can create admin users")
    role = data.role if data.role in ("admin", "user") else "user"
    user = LocalUser(
        email=data.email,
        password_hash=hash_password(data.password),
        role=role,
        permissions=data.permissions if role == "user" else "{}",
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _update_user(user_id: int, data: UserUpdate, db: Session = Depends(get_db), admin=Depends(require_admin)):
    user = db.query(LocalUser).filter(LocalUser.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.email == ADMIN_EMAIL:
        raise HTTPException(status_code=400, detail="Cannot modify the main admin account")
    if user.role in ("admin", "superadmin") and admin.get("role") != "superadmin":
        raise HTTPException(status_code=403, detail="Only superadmin can modify admin users")
    if data.role == "admin" and admin.get("role") != "superadmin":
        raise HTTPException(status_code=403, detail="Only superadmin can assign admin role")
    role = data.role if data.role in ("admin", "user") else "user"
    user.role = role
    user.permissions = data.permissions if role == "user" else "{}"
    db.commit()
    db.refresh(user)
    return user


def _delete_user(user_id: int, db: Session = Depends(get_db), admin=Depends(require_admin)):
    user = db.query(LocalUser).filter(LocalUser.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.email == ADMIN_EMAIL:
        raise HTTPException(status_code=400, detail="Cannot delete admin account")
    if user.role in ("admin", "superadmin") and admin.get("role") != "superadmin":
        raise HTTPException(status_code=403, detail="Only superadmin can delete admin users")
    db.delete(user)
    db.commit()
    return {"deleted": user_id}


class PasswordReset(BaseModel):
    password: str


def _reset_password(user_id: int, data: PasswordReset, db: Session = Depends(get_db), _=Depends(require_admin)):
    if not data.password or len(data.password) < 4:
        raise HTTPException(status_code=422, detail="Password must be at least 4 characters")
    user = db.query(LocalUser).filter(LocalUser.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.password_hash = hash_password(data.password)
    db.commit()
    return {"ok": True}


router.get("/users", response_model=List[UserOut])(_list_users)
router.post("/users", response_model=UserOut, status_code=201)(_create_user)
router.put("/users/{user_id}", response_model=UserOut)(_update_user)
router.delete("/users/{user_id}")(_delete_user)
router.patch("/users/{user_id}/password")(_reset_password)
api_router.get("/users", response_model=List[UserOut])(_list_users)
api_router.post("/users", response_model=UserOut, status_code=201)(_create_user)
api_router.put("/users/{user_id}", response_model=UserOut)(_update_user)
api_router.delete("/users/{user_id}")(_delete_user)
api_router.patch("/users/{user_id}/password")(_reset_password)


# ── Devices (firewall-direct, no DB) ──────────────────────────────────────────

class MACHostCreate(BaseModel):
    name: str
    mac_address: Optional[str] = None
    mac_addresses: Optional[List[str]] = None
    description: str = ""

    @field_validator("mac_address")
    @classmethod
    def validate_single_mac(cls, v):
        if v is None:
            return v
        try:
            return normalize_mac(v)
        except ValueError as e:
            raise ValueError(str(e))

    @field_validator("mac_addresses")
    @classmethod
    def validate_mac_list(cls, v):
        if v is None:
            return v
        if len(v) < 2:
            raise ValueError("MAC list must contain at least 2 addresses")
        result = []
        for mac in v:
            try:
                result.append(normalize_mac(mac))
            except ValueError as e:
                raise ValueError(str(e))
        return result


class MACHostOut(BaseModel):
    name: str
    mac_type: str
    mac_address: str
    mac_addresses: List[str]
    description: str
    is_enabled: bool


def _check_sophos_or_raise():
    import socket
    host = os.getenv("SOPHOS_HOST", "")
    port = int(os.getenv("SOPHOS_PORT", "4444"))
    try:
        sock = socket.create_connection((host, port), timeout=3)
        sock.close()
    except Exception:
        raise HTTPException(status_code=503, detail="Firewall is not connected. Operation blocked.")


def _list_devices(_=Depends(require_section("devices", "toggle"))):
    _check_sophos_or_raise()
    return sophos().get_mac_hosts(firewall_rule())


def _add_device(data: MACHostCreate, db: Session = Depends(get_db), user=Depends(require_section("devices", "full"))):
    _check_sophos_or_raise()
    is_list = bool(data.mac_addresses)
    if not is_list and not data.mac_address:
        raise HTTPException(status_code=422, detail="Provide mac_address or mac_addresses")
    api = sophos()
    if api.mac_host_exists(data.name):
        raise HTTPException(status_code=409, detail="MAC host name already exists on firewall")
    try:
        if is_list:
            api.add_mac_list_host(data.name, data.mac_addresses, data.description)
        else:
            api.add_mac_host(data.name, data.mac_address, data.description or data.name)
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=502, detail=f"Sophos error: {e}")
    log_activity(db, user["email"], "ADD_DEVICE", device_name=data.name)
    primary = data.mac_addresses[0] if is_list else data.mac_address
    return {
        "name": data.name,
        "mac_type": "MACLIST" if is_list else "MACAddress",
        "mac_address": primary,
        "mac_addresses": data.mac_addresses or [],
        "description": data.description,
        "is_enabled": False,
    }


def _edit_device(host_name: str, data: MACHostCreate, db: Session = Depends(get_db), user=Depends(require_section("devices", "full"))):
    _check_sophos_or_raise()
    api = sophos()
    if not api.mac_host_exists(host_name):
        raise HTTPException(status_code=404, detail="MAC host not found on firewall")
    is_list = bool(data.mac_addresses)
    if not is_list and not data.mac_address:
        raise HTTPException(status_code=422, detail="Provide mac_address or mac_addresses")
    new_name = data.name.strip()
    new_mac_type = "MACLIST" if is_list else "MACAddress"
    new_primary = data.mac_addresses[0] if is_list else data.mac_address
    rule = firewall_rule()
    try:
        networks = api.get_rule_networks(rule)
        is_enabled = host_name in networks
        if is_enabled:
            api.remove_from_rule(rule, host_name)
        api.update_mac_host(
            old_name=host_name,
            new_name=new_name,
            mac=new_primary,
            description=data.description,
            mac_type=new_mac_type,
            macs=data.mac_addresses,
        )
        if is_enabled:
            api.add_to_rule(rule, new_name)
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=502, detail=f"Sophos error: {e}")
    log_activity(db, user["email"], "EDIT_DEVICE", device_name=new_name)
    return {
        "name": new_name,
        "mac_type": new_mac_type,
        "mac_address": new_primary,
        "mac_addresses": data.mac_addresses or [],
        "description": data.description,
        "is_enabled": is_enabled,
    }


def _delete_device(host_name: str, db: Session = Depends(get_db), user=Depends(require_section("devices", "full"))):
    _check_sophos_or_raise()
    api = sophos()
    rule = firewall_rule()
    try:
        api.remove_from_rule(rule, host_name)
    except Exception as e:
        print(f"[delete] remove from rule: {e}")
    try:
        if api.mac_host_exists(host_name):
            api.remove_mac_host(host_name)
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=502, detail=f"Firewall denied removal: {e}")
    log_activity(db, user["email"], "DELETE_DEVICE", device_name=host_name)
    return {"deleted": host_name}


def _toggle_device(host_name: str, db: Session = Depends(get_db), user=Depends(require_section("devices", "toggle"))):
    _check_sophos_or_raise()
    api = sophos()
    rule = firewall_rule()
    try:
        networks = api.get_rule_networks(rule)
        is_enabled = host_name in networks
        new_state = not is_enabled
        if new_state:
            api.add_to_rule(rule, host_name)
        else:
            api.remove_from_rule(rule, host_name)
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=502, detail=f"Sophos error: {e}")
    log_activity(db, user["email"], "TOGGLE_ON" if new_state else "TOGGLE_OFF", device_name=host_name)
    hosts = api.get_mac_hosts(rule)
    host = next((h for h in hosts if h["name"] == host_name), None)
    if not host:
        raise HTTPException(status_code=404, detail="MAC host not found on firewall")
    return host


@router.get("/groups")
def list_groups(_=Depends(current_user)):
    return GROUPS


router.get("/devices", response_model=List[MACHostOut])(_list_devices)
router.post("/devices", response_model=MACHostOut, status_code=201)(_add_device)
router.patch("/devices/{host_name}", response_model=MACHostOut)(_edit_device)
router.delete("/devices/{host_name}")(_delete_device)
router.patch("/devices/{host_name}/toggle", response_model=MACHostOut)(_toggle_device)
api_router.get("/devices", response_model=List[MACHostOut])(_list_devices)
api_router.post("/devices", response_model=MACHostOut, status_code=201)(_add_device)
api_router.patch("/devices/{host_name}", response_model=MACHostOut)(_edit_device)
api_router.delete("/devices/{host_name}")(_delete_device)
api_router.patch("/devices/{host_name}/toggle", response_model=MACHostOut)(_toggle_device)


@router.get("/logs")
def get_logs(db: Session = Depends(get_db), _=Depends(require_admin)):
    logs = db.query(ActivityLog).order_by(ActivityLog.created_at.desc()).limit(200).all()
    return logs


# ── IP Hosts (admin only) ─────────────────────────────────────────────────────

IP_TYPES = ("IP", "IPRange", "IPList")


class IPHostCreate(BaseModel):
    name: str
    ip_type: str
    ip_value: str
    description: str = ""

    @field_validator("ip_type")
    @classmethod
    def validate_ip_type(cls, v):
        if v not in IP_TYPES:
            raise ValueError(f"ip_type must be one of {IP_TYPES}")
        return v


class IPHostOut(BaseModel):
    name: str
    ip_type: str
    ip_value: str
    description: str
    is_enabled: bool


def _list_ip_hosts(_=Depends(require_section("iphosts", "toggle"))):
    _check_sophos_or_raise()
    return sophos().get_ip_hosts(firewall_rule())


def _create_ip_host(data: IPHostCreate, db: Session = Depends(get_db), user=Depends(require_section("iphosts", "full"))):
    _check_sophos_or_raise()
    api = sophos()
    if api.ip_host_exists(data.name):
        raise HTTPException(status_code=409, detail="IP host name already exists on firewall")
    try:
        api.add_ip_host(data.name, data.ip_type, data.ip_value, data.description)
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=502, detail=f"Sophos error: {e}")
    log_activity(db, user["email"], "ADD_IP_HOST", device_name=data.name)
    return {"name": data.name, "ip_type": data.ip_type, "ip_value": data.ip_value,
            "description": data.description, "is_enabled": False}


class IPHostEdit(BaseModel):
    name: str
    ip_type: str
    ip_value: str
    description: str = ""

    @field_validator("ip_type")
    @classmethod
    def validate_ip_type(cls, v):
        if v not in IP_TYPES:
            raise ValueError(f"ip_type must be one of {IP_TYPES}")
        return v


def _edit_ip_host(host_name: str, data: IPHostEdit, db: Session = Depends(get_db), user=Depends(require_section("iphosts", "full"))):
    _check_sophos_or_raise()
    api = sophos()
    if not api.ip_host_exists(host_name):
        raise HTTPException(status_code=404, detail="IP host not found on firewall")
    rule = firewall_rule()
    try:
        networks = api.get_rule_networks(rule)
        is_enabled = host_name in networks
        if host_name != data.name or True:
            if is_enabled:
                api.remove_from_rule(rule, host_name)
            api.update_ip_host(host_name, data.name, data.ip_type, data.ip_value, data.description)
            if is_enabled:
                api.add_to_rule(rule, data.name)
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=502, detail=f"Sophos error: {e}")
    log_activity(db, user["email"], "EDIT_IP_HOST", device_name=data.name)
    return {"name": data.name, "ip_type": data.ip_type, "ip_value": data.ip_value,
            "description": data.description, "is_enabled": is_enabled}


def _delete_ip_host(host_name: str, db: Session = Depends(get_db), user=Depends(require_section("iphosts", "full"))):
    _check_sophos_or_raise()
    api = sophos()
    rule = firewall_rule()
    try:
        api.remove_from_rule(rule, host_name)
    except Exception as e:
        print(f"[delete] remove from rule: {e}")
    try:
        if api.ip_host_exists(host_name):
            api.remove_ip_host(host_name)
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=502, detail=f"Firewall denied removal: {e}")
    log_activity(db, user["email"], "DELETE_IP_HOST", device_name=host_name)
    return {"deleted": host_name}


def _toggle_ip_host(host_name: str, db: Session = Depends(get_db), user=Depends(require_section("iphosts", "toggle"))):
    _check_sophos_or_raise()
    api = sophos()
    rule = firewall_rule()
    try:
        networks = api.get_rule_networks(rule)
        is_enabled = host_name in networks
        new_state = not is_enabled
        if new_state:
            api.add_to_rule(rule, host_name)
        else:
            api.remove_from_rule(rule, host_name)
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=502, detail=f"Sophos error: {e}")
    log_activity(db, user["email"], "IP_HOST_ON" if new_state else "IP_HOST_OFF", device_name=host_name)
    hosts = api.get_ip_hosts(rule)
    host = next((h for h in hosts if h["name"] == host_name), None)
    if not host:
        raise HTTPException(status_code=404, detail="IP host not found on firewall")
    return host


router.get("/ip-hosts", response_model=List[IPHostOut])(_list_ip_hosts)
router.post("/ip-hosts", response_model=IPHostOut, status_code=201)(_create_ip_host)
router.patch("/ip-hosts/{host_name}", response_model=IPHostOut)(_edit_ip_host)
router.delete("/ip-hosts/{host_name}")(_delete_ip_host)
router.patch("/ip-hosts/{host_name}/toggle", response_model=IPHostOut)(_toggle_ip_host)
api_router.get("/ip-hosts", response_model=List[IPHostOut])(_list_ip_hosts)
api_router.post("/ip-hosts", response_model=IPHostOut, status_code=201)(_create_ip_host)
api_router.patch("/ip-hosts/{host_name}", response_model=IPHostOut)(_edit_ip_host)
api_router.delete("/ip-hosts/{host_name}")(_delete_ip_host)
api_router.patch("/ip-hosts/{host_name}/toggle", response_model=IPHostOut)(_toggle_ip_host)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/sophos/status")
def sophos_status(_=Depends(current_user)):
    import socket
    host = os.getenv("SOPHOS_HOST", "")
    port = int(os.getenv("SOPHOS_PORT", "4444"))
    try:
        sock = socket.create_connection((host, port), timeout=3)
        sock.close()
        return {"connected": True}
    except Exception as e:
        return {"connected": False, "error": str(e)}


@app.get("/sophos/test")
def sophos_test(_=Depends(current_user)):
    host = os.getenv("SOPHOS_HOST", "")
    port = int(os.getenv("SOPHOS_PORT", "4444"))
    user = os.getenv("SOPHOS_USERNAME", "")
    pwd = os.getenv("SOPHOS_PASSWORD", "")
    try:
        api = sophos()
        api._request("<Get><MACHost></MACHost></Get>", timeout=5)
        return {
            "status": "ok",
            "host": host,
            "port": port,
            "username": user,
            "password_length": len(pwd),
        }
    except Exception as e:
        traceback.print_exc()
        return {
            "status": "error",
            "host": host,
            "port": port,
            "username": user,
            "password_length": len(pwd),
            "error": str(e),
        }


def _get_logs(db: Session = Depends(get_db), _=Depends(require_admin)):
    return db.query(ActivityLog).order_by(ActivityLog.created_at.desc()).limit(200).all()

api_router.get("/logs")(_get_logs)


# ── Firewall Users (admin only) ───────────────────────────────────────────────

class FirewallUserCreate(BaseModel):
    username: str
    name: str
    email: str
    password: str
    group: str
    description: str = ""
    status: str = "Active"

    @field_validator("email")
    @classmethod
    def email_required(cls, v):
        if not v or not v.strip():
            raise ValueError("Email is required")
        return v.strip()

    @field_validator("status")
    @classmethod
    def validate_status(cls, v):
        if v not in ("Active", "Inactive"):
            raise ValueError("status must be Active or Inactive")
        return v


class FirewallUserEdit(BaseModel):
    name: str
    email: str
    group: str
    description: str = ""
    status: str = "Active"
    password: str = ""

    @field_validator("email")
    @classmethod
    def email_required(cls, v):
        if not v or not v.strip():
            raise ValueError("Email is required")
        return v.strip()

    @field_validator("status")
    @classmethod
    def validate_status(cls, v):
        if v not in ("Active", "Inactive"):
            raise ValueError("status must be Active or Inactive")
        return v


def _list_firewall_users(_=Depends(require_section("fwusers", "toggle"))):
    try:
        return sophos().get_firewall_users()
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=502, detail=f"Sophos error: {e}")


def _list_firewall_groups(_=Depends(require_section("fwusers", "toggle"))):
    try:
        return sophos().get_firewall_groups()
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=502, detail=f"Sophos error: {e}")


def _create_firewall_user(data: FirewallUserCreate, db: Session = Depends(get_db), user=Depends(require_section("fwusers", "full"))):
    try:
        sophos().add_firewall_user(
            username=data.username.strip(),
            name=data.name.strip(),
            password=data.password,
            email=data.email,
            group=data.group,
            description=data.description,
            status=data.status,
        )
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=502, detail=f"Sophos error: {e}")
    log_activity(db, user["email"], "ADD_FW_USER", device_name=data.username)
    return {"username": data.username.strip(), "name": data.name.strip(),
            "email": data.email, "group": data.group,
            "status": data.status, "description": data.description}


def _edit_firewall_user(username: str, data: FirewallUserEdit, db: Session = Depends(get_db), user=Depends(require_section("fwusers", "full"))):
    try:
        sophos().update_firewall_user(
            username=username,
            name=data.name.strip(),
            email=data.email,
            group=data.group,
            description=data.description,
            status=data.status,
            password=data.password,
        )
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=502, detail=f"Sophos error: {e}")
    log_activity(db, user["email"], "EDIT_FW_USER", device_name=username)
    return {"username": username, "name": data.name.strip(),
            "email": data.email, "group": data.group,
            "status": data.status, "description": data.description}


def _delete_firewall_user(username: str, db: Session = Depends(get_db), user=Depends(require_section("fwusers", "full"))):
    try:
        sophos().delete_firewall_user(username)
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=502, detail=f"Sophos error: {e}")
    log_activity(db, user["email"], "DELETE_FW_USER", device_name=username)
    return {"deleted": username}


def _toggle_firewall_user_status(username: str, db: Session = Depends(get_db), user=Depends(require_section("fwusers", "toggle"))):
    _check_sophos_or_raise()
    try:
        api = sophos()
        fw_user = api.get_firewall_user(username)
        if not fw_user:
            raise HTTPException(status_code=404, detail="Firewall user not found")
        new_status = "Inactive" if fw_user["status"] == "Active" else "Active"
        api.update_firewall_user(
            username=username,
            name=fw_user["name"],
            email=fw_user["email"],
            group=fw_user["group"],
            description=fw_user["description"],
            status=new_status,
        )
    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=502, detail=f"Sophos error: {e}")
    log_activity(db, user["email"], "FW_USER_ACTIVE" if new_status == "Active" else "FW_USER_INACTIVE", device_name=username)
    return {**fw_user, "status": new_status}


router.get("/firewall-users")(_list_firewall_users)
router.get("/firewall-groups")(_list_firewall_groups)
router.post("/firewall-users", status_code=201)(_create_firewall_user)
router.patch("/firewall-users/{username}")(_edit_firewall_user)
router.delete("/firewall-users/{username}")(_delete_firewall_user)
router.patch("/firewall-users/{username}/toggle")(_toggle_firewall_user_status)
api_router.get("/firewall-users")(_list_firewall_users)
api_router.get("/firewall-groups")(_list_firewall_groups)
api_router.post("/firewall-users", status_code=201)(_create_firewall_user)
api_router.patch("/firewall-users/{username}")(_edit_firewall_user)
api_router.delete("/firewall-users/{username}")(_delete_firewall_user)
api_router.patch("/firewall-users/{username}/toggle")(_toggle_firewall_user_status)

app.include_router(router)
app.include_router(api_router)
