-- ============================================================================
-- AIpbx — Asterisk PJSIP realtime schema (sorcery → ODBC → this database)
--
-- These tables are read live by Asterisk (res_config_odbc + res_pjsip realtime)
-- so that endpoints/auths/aors created by the control-plane API take effect
-- WITHOUT editing pjsip.conf or reloading static config. Asterisk also WRITES
-- ps_contacts on REGISTER, so that table carries the full column set it expects.
--
-- Applied automatically on a fresh DB (mounted into docker-entrypoint-initdb.d).
-- For an existing DB: psql "$DATABASE_URL" -f db/asterisk_realtime.sql
--
-- Column sets follow Asterisk's canonical realtime schema. Boolean/enum fields
-- are stored as text ('yes'/'no', etc.) — Asterisk's realtime layer maps them.
-- ============================================================================

-- ---- AORs ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ps_aors (
    id                       VARCHAR(255) PRIMARY KEY,
    contact                  VARCHAR(255),
    default_expiration       INTEGER,
    mailboxes                VARCHAR(255),
    max_contacts             INTEGER,
    minimum_expiration       INTEGER,
    remove_existing          VARCHAR(5),
    qualify_frequency        INTEGER,
    authenticate_qualify     VARCHAR(5),
    maximum_expiration       INTEGER,
    outbound_proxy           VARCHAR(255),
    support_path             VARCHAR(5),
    qualify_timeout          NUMERIC(7,3),
    voicemail_extension      VARCHAR(40),
    remove_unavailable       VARCHAR(5)
);

-- ---- Auths -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ps_auths (
    id                  VARCHAR(255) PRIMARY KEY,
    auth_type           VARCHAR(16),       -- userpass | md5 | google_oauth
    nonce_lifetime      INTEGER,
    md5_cred            VARCHAR(40),
    password            VARCHAR(255),
    realm               VARCHAR(255),
    username            VARCHAR(255),
    refresh_token       VARCHAR(255),
    oauth_clientid      VARCHAR(255),
    oauth_secret        VARCHAR(255)
);

-- ---- Endpoints -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ps_endpoints (
    id                          VARCHAR(255) PRIMARY KEY,
    transport                   VARCHAR(40),
    aors                        VARCHAR(2048),
    auth                        VARCHAR(255),
    context                     VARCHAR(40),
    disallow                    VARCHAR(200),
    allow                       VARCHAR(200),
    direct_media                VARCHAR(5),
    connected_line_method       VARCHAR(16),
    direct_media_method         VARCHAR(16),
    direct_media_glare_mitigation VARCHAR(16),
    disable_direct_media_on_nat VARCHAR(5),
    dtmf_mode                   VARCHAR(16),
    external_media_address      VARCHAR(40),
    force_rport                 VARCHAR(5),
    ice_support                 VARCHAR(5),
    identify_by                 VARCHAR(80),
    mailboxes                   VARCHAR(40),
    moh_suggest                 VARCHAR(40),
    outbound_auth               VARCHAR(255),
    outbound_proxy              VARCHAR(255),
    rewrite_contact             VARCHAR(5),
    rtp_ipv6                    VARCHAR(5),
    rtp_symmetric               VARCHAR(5),
    send_diversion              VARCHAR(5),
    send_pai                    VARCHAR(5),
    send_rpid                   VARCHAR(5),
    timers_min_se               INTEGER,
    timers                      VARCHAR(8),
    timers_sess_expires         INTEGER,
    callerid                    VARCHAR(40),
    callerid_privacy            VARCHAR(40),
    callerid_tag                VARCHAR(40),
    trust_id_inbound            VARCHAR(5),
    trust_id_outbound           VARCHAR(5),
    send_connected_line         VARCHAR(5),
    media_encryption            VARCHAR(16),
    use_avpf                    VARCHAR(5),
    force_avp                   VARCHAR(5),
    media_use_received_transport VARCHAR(5),
    rtp_timeout                 INTEGER,
    rtp_timeout_hold            INTEGER,
    rtp_keepalive               INTEGER,
    rtcp_mux                    VARCHAR(5),
    allow_overlap               VARCHAR(5),
    dtls_verify                 VARCHAR(40),
    dtls_rekey                  VARCHAR(40),
    dtls_cert_file              VARCHAR(200),
    dtls_private_key            VARCHAR(200),
    dtls_cipher                 VARCHAR(200),
    dtls_ca_file                VARCHAR(200),
    dtls_ca_path                VARCHAR(200),
    dtls_setup                  VARCHAR(16),
    dtls_fingerprint            VARCHAR(16),
    dtls_auto_generate_cert     VARCHAR(5),
    srtp_tag_32                 VARCHAR(5),
    media_address               VARCHAR(40),
    redirect_method             VARCHAR(16),
    set_var                     TEXT,
    message_context             VARCHAR(40),
    accountcode                 VARCHAR(80),
    language                    VARCHAR(40),
    rtp_engine                  VARCHAR(40),
    allow_transfer              VARCHAR(5),
    user_eq_phone               VARCHAR(5),
    moh_passthrough             VARCHAR(5),
    media_encryption_optimistic VARCHAR(5),
    rpid_immediate              VARCHAR(5),
    g726_non_standard           VARCHAR(5),
    inband_progress             VARCHAR(5),
    call_group                  VARCHAR(40),
    pickup_group                VARCHAR(40),
    named_call_group            VARCHAR(40),
    named_pickup_group          VARCHAR(40),
    device_state_busy_at        INTEGER,
    t38_udptl                   VARCHAR(5),
    t38_udptl_ec                VARCHAR(16),
    t38_udptl_maxdatagram       INTEGER,
    fax_detect                  VARCHAR(5),
    t38_udptl_nat               VARCHAR(5),
    t38_udptl_ipv6              VARCHAR(5),
    tone_zone                   VARCHAR(40),
    one_touch_recording         VARCHAR(5),
    record_on_feature           VARCHAR(40),
    record_off_feature          VARCHAR(40),
    rtp_keepalive_interval      INTEGER,
    from_domain                 VARCHAR(255),
    from_user                   VARCHAR(255),
    webrtc                      VARCHAR(5),
    dtls_handshake_timeout      INTEGER,
    incoming_mwi_mailbox        VARCHAR(40),
    bundle                      VARCHAR(5),
    allow_subscribe             VARCHAR(5),
    sub_min_expiry              INTEGER,
    max_audio_streams           INTEGER,
    max_video_streams           INTEGER
);

-- ---- Contacts (Asterisk WRITES these on REGISTER) --------------------------
CREATE TABLE IF NOT EXISTS ps_contacts (
    id                   VARCHAR(255) PRIMARY KEY,
    uri                  VARCHAR(511),
    expiration_time      BIGINT,
    qualify_frequency    INTEGER,
    outbound_proxy       VARCHAR(255),
    path                 TEXT,
    user_agent           VARCHAR(255),
    qualify_timeout      NUMERIC(7,3),
    reg_server           VARCHAR(255),
    authenticate_qualify VARCHAR(5),
    via_addr             VARCHAR(40),
    via_port             INTEGER,
    call_id              VARCHAR(255),
    endpoint             VARCHAR(255),
    prune_on_boot        VARCHAR(5)
);
CREATE INDEX IF NOT EXISTS ps_contacts_qualify_idx ON ps_contacts (qualify_frequency, expiration_time);

-- ---- IP identifies (match inbound trunks by source IP) ---------------------
CREATE TABLE IF NOT EXISTS ps_endpoint_id_ips (
    id            VARCHAR(255) PRIMARY KEY,
    endpoint      VARCHAR(255),
    match         VARCHAR(80),
    srv_lookups   VARCHAR(5),
    match_header  VARCHAR(255),
    match_request_uri VARCHAR(255)
);

-- ---- Outbound registrations (trunks that register to a carrier) ------------
CREATE TABLE IF NOT EXISTS ps_registrations (
    id                       VARCHAR(255) PRIMARY KEY,
    auth_rejection_permanent VARCHAR(5),
    client_uri               VARCHAR(255),
    contact_user             VARCHAR(255),
    expiration               INTEGER,
    max_retries              INTEGER,
    outbound_auth            VARCHAR(255),
    outbound_proxy           VARCHAR(255),
    retry_interval           INTEGER,
    forbidden_retry_interval INTEGER,
    server_uri               VARCHAR(255),
    transport                VARCHAR(40),
    support_path             VARCHAR(5),
    fatal_retry_interval     INTEGER,
    line                     VARCHAR(5),
    endpoint                 VARCHAR(255)
);
