import os
import json
import asyncio
import traceback
from datetime import datetime
from typing import List, Optional

from dotenv import load_dotenv
load_dotenv()

from fastapi import BackgroundTasks, FastAPI, APIRouter, Depends, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, field_validator
from sqlalchemy.orm import Session

from auth import ADMIN_EMAIL, create_jwt, get_user_for_login, hash_password, seed_users_from_env, verify_jwt
from database import Device, GROUPS, LocalUser, SessionLocal, create_tables, get_db
from sophos import SophosAPI, mac_to_host_name, normalize_mac

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


async def _sophos_sync_loop():
    """Every 30 seconds retry syncing any devices that failed to update Sophos."""
    await asyncio.sleep(15)  # wait for backend to fully start
    while True:
        try:
            db = SessionLocal()
            unsynced = db.query(Device).filter(Device.sophos_synced == False).all()
            if unsynced:
                api = sophos()
                rule = firewall_rule()
                for device in unsynced:
                    try:
                        if device.is_enabled:
                            api.add_to_rule(rule, device.sophos_host_name)
                        else:
                            api.remove_from_rule(rule, device.sophos_host_name)
                        device.sophos_synced = True
                        db.commit()
                        print(f"[sync] Synced {device.name} to Sophos")
                    except Exception as e:
                        print(f"[sync] Still failing for {device.name}: {e}")
        except Exception as e:
            print(f"[sync] Loop error: {e}")
        finally:
            db.close()
        await asyncio.sleep(30)


@app.on_event("startup")
async def startup():
    asyncio.create_task(_sophos_sync_loop())

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


def current_user(request: Request) -> dict:
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    user = verify_jwt(auth[7:])
    if not user:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    return user


# ── Auth ──────────────────────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    email: str
    password: str


def _login(data: LoginRequest, db: Session = Depends(get_db)):
    user = get_user_for_login(data.email, data.password)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid email or password")
    db_user = db.query(LocalUser).filter(LocalUser.email == user["email"]).first()
    groups = db_user.groups if db_user else "[]"
    token = create_jwt({
        "email": user["email"],
        "name": user["email"].split("@")[0],
        "role": user["role"],
        "groups": groups,
    })
    return {"token": token}


router.post("/auth/login")(_login)
api_router.post("/auth/login")(_login)


@router.get("/auth/me")
def me(user=Depends(current_user)):
    return user


def require_admin(user=Depends(current_user)):
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


# ── User Management (admin only) ──────────────────────────────────────────────

class UserCreate(BaseModel):
    email: str
    password: str
    role: str = "user"
    groups: List[str] = []


class UserOut(BaseModel):
    id: int
    email: str
    role: str
    groups: str
    created_at: datetime

    class Config:
        from_attributes = True


def _list_users(db: Session = Depends(get_db), _=Depends(require_admin)):
    return db.query(LocalUser).order_by(LocalUser.created_at).all()


def _create_user(data: UserCreate, db: Session = Depends(get_db), _=Depends(require_admin)):
    if db.query(LocalUser).filter(LocalUser.email == data.email).first():
        raise HTTPException(status_code=409, detail="Email already exists")
    role = data.role if data.role in ("admin", "user") else "user"
    valid_groups = [g for g in data.groups if g in GROUPS]
    user = LocalUser(
        email=data.email,
        password_hash=hash_password(data.password),
        role=role,
        groups=json.dumps(valid_groups),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _delete_user(user_id: int, db: Session = Depends(get_db), admin=Depends(require_admin)):
    user = db.query(LocalUser).filter(LocalUser.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.email == ADMIN_EMAIL:
        raise HTTPException(status_code=400, detail="Cannot delete admin account")
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
router.delete("/users/{user_id}")(_delete_user)
router.patch("/users/{user_id}/password")(_reset_password)
api_router.get("/users", response_model=List[UserOut])(_list_users)
api_router.post("/users", response_model=UserOut, status_code=201)(_create_user)
api_router.delete("/users/{user_id}")(_delete_user)
api_router.patch("/users/{user_id}/password")(_reset_password)


# ── Devices ───────────────────────────────────────────────────────────────────

class DeviceCreate(BaseModel):
    name: str
    mac_address: Optional[str] = None
    mac_addresses: Optional[List[str]] = None
    description: str = ""
    group: str = "School"

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


class DeviceOut(BaseModel):
    id: int
    name: str
    mac_address: str
    mac_type: str
    mac_addresses: str
    description: str
    group: str
    is_enabled: bool
    sophos_synced: bool
    sophos_host_name: str
    created_at: datetime

    class Config:
        from_attributes = True


@router.get("/devices", response_model=List[DeviceOut])
def list_devices(db: Session = Depends(get_db), user=Depends(current_user)):
    if user.get("role") == "admin":
        return db.query(Device).order_by(Device.created_at.desc()).all()
    # Normal user — filter by their assigned groups
    user_groups = json.loads(user.get("groups", "[]"))
    if not user_groups:
        return []
    return db.query(Device).filter(Device.group.in_(user_groups)).order_by(Device.created_at.desc()).all()


@router.get("/groups")
def list_groups(_=Depends(current_user)):
    return GROUPS


@router.post("/devices", response_model=DeviceOut, status_code=201)
def add_device(data: DeviceCreate, db: Session = Depends(get_db), _=Depends(require_admin)):
    is_list = bool(data.mac_addresses)

    if not is_list and not data.mac_address:
        raise HTTPException(status_code=422, detail="Provide mac_address or mac_addresses")

    primary_mac = data.mac_addresses[0] if is_list else data.mac_address

    if db.query(Device).filter(Device.mac_address == primary_mac).first():
        raise HTTPException(status_code=409, detail="MAC address already registered")

    try:
        api = sophos()
        if is_list:
            api.add_mac_list_host(data.name, data.mac_addresses, data.description)
        else:
            api.add_mac_host(data.name, data.mac_address, data.description or data.name)
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=502, detail=f"Sophos error: {e}")

    group = data.group if data.group in GROUPS else GROUPS[0]
    device = Device(
        name=data.name,
        mac_address=primary_mac,
        mac_type="MACLIST" if is_list else "MACAddress",
        mac_addresses=json.dumps(data.mac_addresses) if is_list else "[]",
        description=data.description,
        group=group,
        is_enabled=False,
        sophos_host_name=data.name,
    )
    db.add(device)
    db.commit()
    db.refresh(device)
    return device


class DeviceEdit(BaseModel):
    name: str
    mac_address: Optional[str] = None
    mac_addresses: Optional[List[str]] = None
    description: str = ""
    group: str = "School"

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


@router.patch("/devices/{device_id}", response_model=DeviceOut)
def edit_device(device_id: int, data: DeviceEdit, db: Session = Depends(get_db), _=Depends(require_admin)):
    device = db.query(Device).filter(Device.id == device_id).first()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    is_list = bool(data.mac_addresses)
    if not is_list and not data.mac_address:
        raise HTTPException(status_code=422, detail="Provide mac_address or mac_addresses")

    new_primary_mac = data.mac_addresses[0] if is_list else data.mac_address
    new_name = data.name.strip()
    new_mac_type = "MACLIST" if is_list else "MACAddress"

    # Check MAC conflict only if MAC actually changed
    if new_primary_mac != device.mac_address:
        conflict = db.query(Device).filter(Device.mac_address == new_primary_mac, Device.id != device_id).first()
        if conflict:
            raise HTTPException(status_code=409, detail="MAC address already registered to another device")

    old_sophos_name = device.sophos_host_name
    name_changed = new_name != old_sophos_name
    mac_changed = new_primary_mac != device.mac_address

    if name_changed or mac_changed:
        try:
            api = sophos()
            # If device is enabled, remove old name from rule first
            if device.is_enabled:
                api.remove_from_rule(firewall_rule(), old_sophos_name)
            # Delete old host and create new one
            api.update_mac_host(
                old_name=old_sophos_name,
                new_name=new_name,
                mac=new_primary_mac,
                description=data.description,
                mac_type=new_mac_type,
                macs=data.mac_addresses,
            )
            # If device was enabled, add new name back to rule
            if device.is_enabled:
                api.add_to_rule(firewall_rule(), new_name)
        except Exception as e:
            traceback.print_exc()
            raise HTTPException(status_code=502, detail=f"Sophos error: {e}")

    device.name = new_name
    device.sophos_host_name = new_name
    device.mac_address = new_primary_mac
    device.mac_type = new_mac_type
    device.mac_addresses = json.dumps(data.mac_addresses) if is_list else "[]"
    device.description = data.description
    device.group = data.group if data.group in GROUPS else device.group
    db.commit()
    db.refresh(device)
    return device


@router.delete("/devices/{device_id}")
def delete_device(device_id: int, background_tasks: BackgroundTasks, db: Session = Depends(get_db), _=Depends(require_admin)):
    device = db.query(Device).filter(Device.id == device_id).first()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    host_name = device.sophos_host_name
    rule = firewall_rule()
    api = sophos()

    db.delete(device)
    db.commit()

    def _cleanup():
        try:
            api.remove_from_rule(rule, host_name)
        except Exception as e:
            traceback.print_exc()
            print(f"[bg] Sophos remove from rule failed for {host_name}: {e}")
        try:
            if api.mac_host_exists(host_name):
                api.remove_mac_host(host_name)
        except Exception as e:
            traceback.print_exc()
            print(f"[bg] Sophos remove host failed for {host_name}: {e}")

    background_tasks.add_task(_cleanup)
    return {"deleted": device_id}


def _check_sophos_or_raise():
    import socket
    host = os.getenv("SOPHOS_HOST", "")
    port = int(os.getenv("SOPHOS_PORT", "4444"))
    try:
        sock = socket.create_connection((host, port), timeout=3)
        sock.close()
    except Exception:
        raise HTTPException(status_code=503, detail="Firewall is not connected. Operation blocked.")


@router.patch("/devices/{device_id}/toggle", response_model=DeviceOut)
def toggle_device(device_id: int, db: Session = Depends(get_db), _=Depends(current_user)):
    _check_sophos_or_raise()
    device = db.query(Device).filter(Device.id == device_id).first()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    new_state = not device.is_enabled

    # Save to DB first — refresh during Sophos call shows correct state
    device.is_enabled = new_state
    db.commit()

    try:
        if new_state:
            sophos().add_to_rule(firewall_rule(), device.sophos_host_name)
        else:
            sophos().remove_from_rule(firewall_rule(), device.sophos_host_name)
    except Exception as e:
        traceback.print_exc()
        # Revert DB on Sophos failure
        device.is_enabled = not new_state
        db.commit()
        db.refresh(device)
        raise HTTPException(status_code=502, detail=f"Sophos error: {e}")

    db.refresh(device)
    return device


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
        members = api.get_group_members(mac_group())
        return {
            "status": "ok",
            "host": host,
            "port": port,
            "username": user,
            "password_length": len(pwd),
            "mac_group": mac_group(),
            "group_members": members,
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


app.include_router(router)
app.include_router(api_router)
