import os
import hashlib
import secrets
from jose import jwt, JWTError
from datetime import datetime, timedelta


ADMIN_EMAIL = "itvinay@healparadise.org"


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    h = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 260000)
    return f"{salt}${h.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        salt, h = stored.split("$", 1)
        check = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 260000)
        return check.hex() == h
    except Exception:
        return False


def seed_users_from_env():
    from database import SessionLocal, LocalUser
    raw = os.getenv("LOCAL_USERS", "")
    if not raw:
        return
    db = SessionLocal()
    try:
        if db.query(LocalUser).count() > 0:
            admin = db.query(LocalUser).filter(LocalUser.email == ADMIN_EMAIL).first()
            if admin and admin.role != "superadmin":
                admin.role = "superadmin"
                db.commit()
            return
        for entry in raw.split(","):
            entry = entry.strip()
            if ":" not in entry:
                continue
            email, password = entry.split(":", 1)
            email, password = email.strip(), password.strip()
            if email and password:
                role = "superadmin" if email == ADMIN_EMAIL else "user"
                db.add(LocalUser(email=email, password_hash=hash_password(password), role=role))
        db.commit()
    finally:
        db.close()


def get_user_for_login(email: str, password: str):
    from database import SessionLocal, LocalUser
    db = SessionLocal()
    try:
        user = db.query(LocalUser).filter(LocalUser.email == email).first()
        if not user or not verify_password(password, user.password_hash):
            return None
        return {"email": user.email, "role": user.role, "permissions": user.permissions or "{}"}
    finally:
        db.close()


def create_jwt(data: dict) -> str:
    payload = {**data, "exp": datetime.utcnow() + timedelta(hours=1)}
    return jwt.encode(payload, os.getenv("JWT_SECRET", "dev-secret"), algorithm="HS256")


def verify_jwt(token: str) -> dict | None:
    try:
        return jwt.decode(token, os.getenv("JWT_SECRET", "dev-secret"), algorithms=["HS256"])
    except JWTError:
        return None
