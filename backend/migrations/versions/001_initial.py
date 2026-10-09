"""Persist synthetic evidence, assessments and analyst reviews."""
from alembic import op
import sqlalchemy as sa

revision = "001"
down_revision = None


def upgrade():
    op.create_table("identities", sa.Column("id", sa.String(64), primary_key=True), sa.Column("cohort", sa.String(16), nullable=False), sa.Column("payload", sa.JSON, nullable=False))
    op.create_index("ix_identities_cohort", "identities", ["cohort"])
    op.create_table("observations", sa.Column("id", sa.String(100), primary_key=True), sa.Column("identity_id", sa.String(64), sa.ForeignKey("identities.id"), nullable=False), sa.Column("device_token", sa.String(100), nullable=False), sa.Column("timestamp", sa.String(40), nullable=False), sa.Column("payload", sa.JSON, nullable=False))
    op.create_index("ix_observations_identity_id", "observations", ["identity_id"])
    op.create_index("ix_observations_device_token", "observations", ["device_token"])
    op.create_table("entity_links", sa.Column("id", sa.Integer, primary_key=True), sa.Column("identity_id", sa.String(64), sa.ForeignKey("identities.id"), nullable=False), sa.Column("kind", sa.String(16), nullable=False), sa.Column("token", sa.String(100), nullable=False))
    op.create_index("ix_entity_links_identity_id", "entity_links", ["identity_id"])
    op.create_index("ix_entity_kind_token", "entity_links", ["kind", "token"])
    op.create_table("assessments", sa.Column("id", sa.Integer, primary_key=True), sa.Column("identity_id", sa.String(64), sa.ForeignKey("identities.id"), nullable=False), sa.Column("version", sa.String(20), nullable=False), sa.Column("created_at", sa.DateTime(timezone=True), nullable=False), sa.Column("payload", sa.JSON, nullable=False))
    op.create_index("ix_assessments_identity_id", "assessments", ["identity_id"])
    op.create_table("reviews", sa.Column("identity_id", sa.String(64), sa.ForeignKey("identities.id"), primary_key=True), sa.Column("status", sa.String(30), nullable=False), sa.Column("revision", sa.Integer, nullable=False), sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False), sa.Column("updated_by", sa.String(200), nullable=False))
    op.create_table("review_notes", sa.Column("id", sa.Integer, primary_key=True), sa.Column("identity_id", sa.String(64), sa.ForeignKey("identities.id"), nullable=False), sa.Column("text", sa.String(4000), nullable=False), sa.Column("author", sa.String(200), nullable=False), sa.Column("created_at", sa.DateTime(timezone=True), nullable=False))
    op.create_index("ix_review_notes_identity_id", "review_notes", ["identity_id"])
    op.create_table("audit_events", sa.Column("id", sa.Integer, primary_key=True), sa.Column("identity_id", sa.String(64)), sa.Column("actor", sa.String(200), nullable=False), sa.Column("action", sa.String(40), nullable=False), sa.Column("details", sa.JSON, nullable=False), sa.Column("created_at", sa.DateTime(timezone=True), nullable=False))
    op.create_index("ix_audit_events_identity_id", "audit_events", ["identity_id"])
    op.create_table("auth_sessions", sa.Column("token_hash", sa.String(64), primary_key=True), sa.Column("actor", sa.String(200), nullable=False), sa.Column("role", sa.String(20), nullable=False), sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False))
    op.create_table("evaluation_labels", sa.Column("identity_id", sa.String(64), sa.ForeignKey("identities.id"), primary_key=True), sa.Column("label", sa.String(20), nullable=False))


def downgrade():
    raise RuntimeError("Destructive downgrade is disabled. Restore a database backup instead.")
