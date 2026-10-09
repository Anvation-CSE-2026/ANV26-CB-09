from datetime import datetime, timezone
from sqlalchemy import create_engine, String, ForeignKey, JSON, Integer, DateTime, Index, UniqueConstraint, Boolean
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker
from sqlalchemy.pool import NullPool
import os
from .config import settings


def now():
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class Identity(Base):
    __tablename__ = "identities"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    cohort: Mapped[str] = mapped_column(String(16), index=True)
    payload: Mapped[dict] = mapped_column(JSON)


class Observation(Base):
    __tablename__ = "observations"
    id: Mapped[str] = mapped_column(String(100), primary_key=True)
    identity_id: Mapped[str] = mapped_column(ForeignKey("identities.id"), index=True)
    device_token: Mapped[str] = mapped_column(String(100), index=True)
    timestamp: Mapped[str] = mapped_column(String(40))
    payload: Mapped[dict] = mapped_column(JSON)


class EntityLink(Base):
    __tablename__ = "entity_links"
    id: Mapped[int] = mapped_column(primary_key=True)
    identity_id: Mapped[str] = mapped_column(ForeignKey("identities.id"), index=True)
    kind: Mapped[str] = mapped_column(String(16))
    token: Mapped[str] = mapped_column(String(100))
    __table_args__ = (Index("ix_entity_kind_token", "kind", "token"),)


class Assessment(Base):
    __tablename__ = "assessments"
    id: Mapped[int] = mapped_column(primary_key=True)
    identity_id: Mapped[str] = mapped_column(ForeignKey("identities.id"), index=True)
    version: Mapped[str] = mapped_column(String(20))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    payload: Mapped[dict] = mapped_column(JSON)


class Review(Base):
    __tablename__ = "reviews"
    identity_id: Mapped[str] = mapped_column(ForeignKey("identities.id"), primary_key=True)
    status: Mapped[str] = mapped_column(String(30), default="Unreviewed")
    revision: Mapped[int] = mapped_column(Integer, default=0)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_by: Mapped[str] = mapped_column(String(200), default="")


class Note(Base):
    __tablename__ = "review_notes"
    id: Mapped[int] = mapped_column(primary_key=True)
    identity_id: Mapped[str] = mapped_column(ForeignKey("identities.id"), index=True)
    text: Mapped[str] = mapped_column(String(4000))
    author: Mapped[str] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Audit(Base):
    __tablename__ = "audit_events"
    id: Mapped[int] = mapped_column(primary_key=True)
    identity_id: Mapped[str | None] = mapped_column(String(64), index=True)
    actor: Mapped[str] = mapped_column(String(200))
    action: Mapped[str] = mapped_column(String(40))
    details: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class AuthSession(Base):
    __tablename__ = "auth_sessions"
    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    actor: Mapped[str] = mapped_column(String(200))
    role: Mapped[str] = mapped_column(String(20))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class EvaluationLabel(Base):
    __tablename__ = "evaluation_labels"
    identity_id: Mapped[str] = mapped_column(ForeignKey("identities.id"), primary_key=True)
    label: Mapped[str] = mapped_column(String(20))


class Organisation(Base):
    __tablename__ = "organisations"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Account(Base):
    __tablename__ = "accounts"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    username: Mapped[str] = mapped_column(String(60), unique=True)
    display_name: Mapped[str] = mapped_column(String(80))
    password_hash: Mapped[str] = mapped_column(String(250))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Membership(Base):
    __tablename__ = "memberships"
    organisation_id: Mapped[str] = mapped_column(ForeignKey("organisations.id"), primary_key=True)
    account_id: Mapped[str] = mapped_column(ForeignKey("accounts.id"), primary_key=True)
    role: Mapped[str] = mapped_column(String(20))
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class WorkspaceSession(Base):
    __tablename__ = "workspace_sessions"
    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    organisation_id: Mapped[str] = mapped_column(ForeignKey("organisations.id"))
    account_id: Mapped[str] = mapped_column(ForeignKey("accounts.id"))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class Invitation(Base):
    __tablename__ = "invitations"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    organisation_id: Mapped[str] = mapped_column(ForeignKey("organisations.id"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    role: Mapped[str] = mapped_column(String(20))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked: Mapped[bool] = mapped_column(Boolean, default=False)


class Integration(Base):
    __tablename__ = "integrations"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    organisation_id: Mapped[str] = mapped_column(ForeignKey("organisations.id"), index=True)
    name: Mapped[str] = mapped_column(String(80))
    origins: Mapped[list] = mapped_column(JSON)
    key_hash: Mapped[str] = mapped_column(String(64), unique=True)
    key_prefix: Mapped[str] = mapped_column(String(20))
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class WorkspaceCase(Base):
    __tablename__ = "workspace_cases"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    organisation_id: Mapped[str] = mapped_column(ForeignKey("organisations.id"), index=True)
    external_id: Mapped[str] = mapped_column(String(64))
    payload: Mapped[dict] = mapped_column(JSON)
    revision: Mapped[int] = mapped_column(Integer, default=1)
    evidence_revision: Mapped[int] = mapped_column(Integer, default=1)
    review_status: Mapped[str] = mapped_column(String(30), default="Unreviewed")
    assigned_to: Mapped[str | None] = mapped_column(ForeignKey("accounts.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    __table_args__ = (UniqueConstraint("organisation_id", "external_id", name="uq_workspace_external_id"),)


class WorkspaceAssessment(Base):
    __tablename__ = "workspace_assessments"
    id: Mapped[int] = mapped_column(primary_key=True)
    organisation_id: Mapped[str] = mapped_column(ForeignKey("organisations.id"), index=True)
    case_id: Mapped[str] = mapped_column(ForeignKey("workspace_cases.id"), index=True)
    policy_version: Mapped[str] = mapped_column(String(30))
    evidence_revision: Mapped[int] = mapped_column(Integer)
    payload: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class WorkspaceAudit(Base):
    __tablename__ = "workspace_audit"
    id: Mapped[int] = mapped_column(primary_key=True)
    organisation_id: Mapped[str] = mapped_column(ForeignKey("organisations.id"), index=True)
    case_id: Mapped[str | None] = mapped_column(String(36), index=True)
    actor: Mapped[str] = mapped_column(String(80))
    action: Mapped[str] = mapped_column(String(40))
    details: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class EvidenceEvent(Base):
    __tablename__ = "evidence_events"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    organisation_id: Mapped[str] = mapped_column(ForeignKey("organisations.id"), index=True)
    case_id: Mapped[str] = mapped_column(ForeignKey("workspace_cases.id"), index=True)
    external_id: Mapped[str] = mapped_column(String(160))
    source: Mapped[str] = mapped_column(String(30))
    payload: Mapped[dict] = mapped_column(JSON)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    __table_args__ = (UniqueConstraint("organisation_id", "external_id", name="uq_workspace_event"),)


class CollectionTicket(Base):
    __tablename__ = "collection_tickets"
    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    integration_id: Mapped[str] = mapped_column(ForeignKey("integrations.id"))
    case_id: Mapped[str] = mapped_column(ForeignKey("workspace_cases.id"))
    session_id: Mapped[str] = mapped_column(String(36))
    browser_token: Mapped[str] = mapped_column(String(100))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ImportBatch(Base):
    __tablename__ = "import_batches"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    organisation_id: Mapped[str] = mapped_column(ForeignKey("organisations.id"), index=True)
    actor: Mapped[str] = mapped_column(String(80))
    filename: Mapped[str] = mapped_column(String(100))
    imported_count: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class HostedAccess(Base):
    __tablename__ = "hosted_access"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    organisation_id: Mapped[str] = mapped_column(ForeignKey("organisations.id"), index=True)
    case_id: Mapped[str] = mapped_column(ForeignKey("workspace_cases.id"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    session_id: Mapped[str] = mapped_column(String(36))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    browser_token: Mapped[str | None] = mapped_column(String(100))
    summary: Mapped[dict | None] = mapped_column(JSON)
    revoked: Mapped[bool] = mapped_column(Boolean, default=False)


class AuthThrottle(Base):
    __tablename__ = "auth_throttle"
    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    reset_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class EvidenceRequest(Base):
    __tablename__ = "evidence_requests"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    organisation_id: Mapped[str] = mapped_column(ForeignKey("organisations.id"), index=True)
    case_id: Mapped[str] = mapped_column(ForeignKey("workspace_cases.id"), index=True)
    requested_by: Mapped[str] = mapped_column(ForeignKey("accounts.id"))
    assigned_to: Mapped[str | None] = mapped_column(ForeignKey("accounts.id"))
    category: Mapped[str] = mapped_column(String(40))
    description: Mapped[str] = mapped_column(String(1000))
    status: Mapped[str] = mapped_column(String(20), default="Open")
    resolution: Mapped[str] = mapped_column(String(1000), default="")
    revision: Mapped[int] = mapped_column(Integer, default=1)
    due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class RecoveryEmail(Base):
    __tablename__ = "recovery_emails"
    account_id: Mapped[str] = mapped_column(ForeignKey("accounts.id"), primary_key=True)
    email: Mapped[str] = mapped_column(String(254), unique=True)
    verified_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class EmailAction(Base):
    __tablename__ = "email_actions"
    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    account_id: Mapped[str] = mapped_column(ForeignKey("accounts.id"), index=True)
    email: Mapped[str] = mapped_column(String(254))
    purpose: Mapped[str] = mapped_column(String(20))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


cloud_options = {"poolclass": NullPool, "connect_args": {"prepare_threshold": None}} if os.environ.get("VERCEL") == "1" else {}
engine = create_engine(settings.database_url, pool_pre_ping=True, **cloud_options)
SessionLocal = sessionmaker(bind=engine)


def get_db():
    with SessionLocal() as db:
        yield db
