from sqlalchemy import create_engine, Column, Integer, String, Boolean, DateTime, text
from sqlalchemy.orm import declarative_base, sessionmaker
from datetime import datetime

engine = create_engine(
    "sqlite:///./netguard.db",
    connect_args={"check_same_thread": False}
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

GROUPS = ["School", "Campus"]


class Device(Base):
    __tablename__ = "devices"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    mac_address = Column(String, unique=True, nullable=False)
    mac_type = Column(String, default="MACAddress")
    mac_addresses = Column(String, default="")
    description = Column(String, default="")
    group = Column(String, default="School")
    is_enabled = Column(Boolean, default=False)
    sophos_synced = Column(Boolean, default=True)
    sophos_host_name = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class LocalUser(Base):
    __tablename__ = "local_users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, nullable=False)
    password_hash = Column(String, nullable=False)
    role = Column(String, default="user")
    groups = Column(String, default="[]")
    session_id = Column(String, default="")
    created_at = Column(DateTime, default=datetime.utcnow)


class ActivityLog(Base):
    __tablename__ = "activity_logs"

    id = Column(Integer, primary_key=True, index=True)
    user_email = Column(String, nullable=False)
    action = Column(String, nullable=False)
    device_name = Column(String, default="")
    details = Column(String, default="")
    created_at = Column(DateTime, default=datetime.utcnow)


def create_tables():
    Base.metadata.create_all(bind=engine)
    with engine.connect() as conn:
        for stmt in [
            "ALTER TABLE devices ADD COLUMN mac_type VARCHAR DEFAULT 'MACAddress'",
            "ALTER TABLE devices ADD COLUMN mac_addresses TEXT DEFAULT ''",
            "ALTER TABLE devices ADD COLUMN \"group\" VARCHAR DEFAULT 'School'",
            "ALTER TABLE local_users ADD COLUMN role VARCHAR DEFAULT 'user'",
            "ALTER TABLE local_users ADD COLUMN groups TEXT DEFAULT '[]'",
            "ALTER TABLE devices ADD COLUMN sophos_synced BOOLEAN DEFAULT 1",
            "ALTER TABLE local_users ADD COLUMN session_id VARCHAR DEFAULT ''",
        ]:
            try:
                conn.execute(text(stmt))
                conn.commit()
            except Exception:
                pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
