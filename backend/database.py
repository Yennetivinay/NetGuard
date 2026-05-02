from sqlalchemy import create_engine, Column, Integer, String, DateTime, Text, text
from sqlalchemy.orm import declarative_base, sessionmaker
from datetime import datetime

engine = create_engine(
    "sqlite:///./netguard.db",
    connect_args={"check_same_thread": False}
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

GROUPS = ["School", "Campus"]


class LocalUser(Base):
    __tablename__ = "local_users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, nullable=False)
    password_hash = Column(String, nullable=False)
    role = Column(String, default="user")
    session_id = Column(String, default="")
    permissions = Column(Text, default="{}")
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
            "ALTER TABLE local_users ADD COLUMN role VARCHAR DEFAULT 'user'",
            "ALTER TABLE local_users ADD COLUMN session_id VARCHAR DEFAULT ''",
            "ALTER TABLE local_users ADD COLUMN permissions TEXT DEFAULT '{}'",
            "ALTER TABLE local_users DROP COLUMN groups",
            "DROP TABLE IF EXISTS devices",
            "DROP TABLE IF EXISTS ip_hosts",
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
