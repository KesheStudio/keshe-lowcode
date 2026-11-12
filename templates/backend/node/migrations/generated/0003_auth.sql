-- [LC-GENERATED] 认证中心表结构：用户、角色、权限、会话 / 刷新令牌、登录失败计数。
-- 迁移由平台的迁移执行器保证只跑一次；SQL 本身按“先建表再播种”顺序编写。

CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(64) PRIMARY KEY,
  username VARCHAR(64) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  display_name VARCHAR(128) NOT NULL DEFAULT '',
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  created_at VARCHAR(32) NOT NULL,
  updated_at VARCHAR(32) NOT NULL
);

CREATE TABLE IF NOT EXISTS roles (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(64) NOT NULL UNIQUE,
  description VARCHAR(255) NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS permissions (
  id VARCHAR(64) PRIMARY KEY,
  code VARCHAR(128) NOT NULL UNIQUE,
  description VARCHAR(255) NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id VARCHAR(64) NOT NULL,
  role_id VARCHAR(64) NOT NULL,
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id VARCHAR(64) NOT NULL,
  permission_id VARCHAR(64) NOT NULL,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS auth_refresh_tokens (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  token_hash VARCHAR(128) NOT NULL UNIQUE,
  family_id VARCHAR(64) NOT NULL,
  created_at VARCHAR(32) NOT NULL,
  expires_at VARCHAR(32) NOT NULL,
  revoked_at VARCHAR(32) NULL
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  token_hash VARCHAR(128) NOT NULL UNIQUE,
  created_at VARCHAR(32) NOT NULL,
  expires_at VARCHAR(32) NOT NULL,
  revoked_at VARCHAR(32) NULL,
  user_agent VARCHAR(255) NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS auth_login_attempts (
  identifier VARCHAR(190) PRIMARY KEY,
  failures INTEGER NOT NULL DEFAULT 0,
  window_started_at VARCHAR(32) NOT NULL,
  locked_until VARCHAR(32) NULL
);

INSERT INTO roles (id, name, description) VALUES ('role_admin', 'admin', '管理员，拥有全部权限');
INSERT INTO roles (id, name, description) VALUES ('role_user', 'user', '普通用户，可读写 items');

INSERT INTO permissions (id, code, description) VALUES ('perm_items_read', 'items:read', '读取 items');
INSERT INTO permissions (id, code, description) VALUES ('perm_items_write', 'items:write', '写入 items');
INSERT INTO permissions (id, code, description) VALUES ('perm_users_read', 'users:read', '查看用户列表');
INSERT INTO permissions (id, code, description) VALUES ('perm_auth_manage', 'auth:manage', '管理认证与会话');

INSERT INTO role_permissions (role_id, permission_id) VALUES ('role_admin', 'perm_items_read');
INSERT INTO role_permissions (role_id, permission_id) VALUES ('role_admin', 'perm_items_write');
INSERT INTO role_permissions (role_id, permission_id) VALUES ('role_admin', 'perm_users_read');
INSERT INTO role_permissions (role_id, permission_id) VALUES ('role_admin', 'perm_auth_manage');
INSERT INTO role_permissions (role_id, permission_id) VALUES ('role_user', 'perm_items_read');
INSERT INTO role_permissions (role_id, permission_id) VALUES ('role_user', 'perm_items_write');
