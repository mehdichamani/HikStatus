# HikVision Authentication Setup

This guide explains how to:

- Enable Digest Authentication on HikVision NVRs
- Create a non-admin user for HikStatus
- Select the minimum required permissions

---

## Why Digest Authentication Is Required

HikStatus uses HikVision ISAPI endpoints such as:

- `/ISAPI/ContentMgmt/InputProxy/channels`
- `/ISAPI/ContentMgmt/InputProxy/channels/status`

Many HikVision devices reject requests unless:

- ISAPI is enabled
- Digest Authentication is enabled

If your NVR cannot be added or cameras stay offline while credentials are correct, Digest Authentication is usually the cause.

---

## Enable Digest Authentication

Menu names may vary slightly between firmware versions.

### Step 1 — Open NVR Web Interface

Open:

```text
http://NVR_IP_ADDRESS
```

Login with an administrator account.

---

### Step 2 — Open Security Settings

Go to:

```text
Configuration → System → Security
```

or:

```text
Configuration → Network → Advanced Settings → Integration Protocol
```

---

### Step 3 — Enable ISAPI

Find:

```text
Enable Hikvision-CGI
```

or:

```text
Enable ISAPI
```

Enable it.

---

### Step 4 — Select Authentication Method

Set authentication mode to:

```text
digest/basic
```

or:

```text
Digest Authentication
```

Avoid:

```text
basic only
```

Save settings and reboot the NVR if required.

---

## Create a Non-Admin User for HikStatus

Using a dedicated monitoring account is recommended instead of using the main admin account.

### Step 1 — Open User Management

Go to:

```text
Configuration → System → User Management
```

---

### Step 2 — Add User

Create a new user.

Example:

```text
Username: hikstatus
Password: strong-password
```

---

### Step 3 — Required Permissions

The user only needs read/preview permissions.

Recommended permissions:

- Remote Configuration
- View Device Information
- Preview
- Camera Status
- Remote Log Search (optional)

Depending on firmware version, the names may differ slightly.

Usually these permission groups are sufficient:

```text
Remote Configuration
Remote Live View
Device Management (Read Only)
```

---

## Recommended Security Practice

Avoid using:

- Full administrator account
- Shared passwords
- Internet-exposed NVR web interfaces

Recommended:

- Use a dedicated read-only account
- Restrict NVR access to local/VPN networks
- Change default passwords
- Disable unused protocols

---

## Common Problems

### 401 Unauthorized

Usually caused by:

- Wrong password
- Digest authentication disabled
- ISAPI disabled

---

### Cameras Show Offline But NVR Is Reachable

Usually caused by:

- Missing permissions
- Old firmware
- ISAPI disabled

---

### Cameras Names Do Not Sync

Check:

- ISAPI enabled
- Digest authentication enabled
- User has Remote Configuration permission
