# ADR-004: Broker Security & Credential Management

**Date:** 2026-06-06  
**Status:** Accepted  
**Participants:** Security Team, Architecture Review Board

## Problem

Live trading requires storing broker credentials (API keys, session tokens, passwords) which are high-value targets for attackers. We must:

1. **Never store plaintext** credentials
2. **Encrypt at rest** (AES-256-GCM)
3. **Rotate tokens** automatically
4. **Audit access** to credentials
5. **Isolate secrets** from application logs
6. **Support key rotation** without downtime

## Solution

Implement **tiered credential management** with encryption, rotation, and audit logging.

### Architecture

```
BrokerAccount (DB row)
├─ Metadata (public)
│  ├─ brokerName: 'ZERODHA'
│  ├─ accountId: 'ABC123'
│  └─ authorized: true
└─ Credentials (encrypted at rest)
   ├─ credentialsEncrypted (AES-256-GCM)
   └─ keyId: 'KEY-001' (which key was used)

KeyStore (secure, external)
├─ KEY-001 (active)
├─ KEY-002 (rotating)
└─ KEY-003 (deprecated)
```

### Credential Types

**Type 1: OAuth (Zerodha, Upstox)**

```typescript
interface OAuthCredential {
  provider: 'ZERODHA' | 'UPSTOX';
  accessToken: string; // Bearer token
  refreshToken: string; // Token refresh
  expiresAt: number; // Token expiry timestamp
  redirectUri: string; // OAuth callback URL (non-sensitive)
}
```

**Type 2: API Key (AngelOne, Shoonya, Fyers)**

```typescript
interface ApiKeyCredential {
  provider: 'ANGELONE' | 'SHOONYA' | 'FYERS';
  apiKey: string; // API key
  apiSecret?: string; // Some brokers have dual keys
  clientCode?: string; // Unique client identifier
}
```

**Type 3: Password-Based (Legacy/TOTP)**

```typescript
interface PasswordCredential {
  provider: string;
  username: string; // Trading ID
  passwordHash: string; // bcryptjs hash (never plaintext)
  totp?: string; // Time-based OTP (encrypted)
  securityAnswers?: Record<string, string>; // Encrypted Q&A
}
```

### Encryption Strategy

**Algorithm:** AES-256-GCM

- Key size: 256 bits (32 bytes)
- IV: 96 bits (12 bytes), random per encryption
- Tag: 128 bits (16 bytes), authentication

**Why AES-256-GCM:**

- NIST approved for US government (FIPS 140-2)
- Authenticated encryption (detects tampering)
- Fast in hardware accelerators
- Standard in crypto libraries (Node.js native crypto)

```typescript
// packages/broker-sdk/src/common/encryption/credential-encryptor.ts

import crypto from 'crypto';

export class CredentialEncryptor {
  constructor(private masterKey: Buffer) {} // 32 bytes = 256 bits

  encrypt(plaintext: any): { encrypted: string; keyId: string } {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.masterKey, iv);

    let encrypted = cipher.update(JSON.stringify(plaintext), 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const tag = cipher.getAuthTag();

    // Format: iv.encrypted.tag (hex-encoded)
    const payload = `${iv.toString('hex')}.${encrypted}.${tag.toString('hex')}`;

    return { encrypted: payload, keyId: 'KEY-001' };
  }

  decrypt(payload: string): any {
    const [ivHex, encryptedHex, tagHex] = payload.split('.');

    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const encrypted = encryptedHex;

    const decipher = crypto.createDecipheriv('aes-256-gcm', this.masterKey, iv);
    decipher.setAuthTag(tag);

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return JSON.parse(decrypted);
  }
}
```

### Key Management

**Master Key Storage:**

1. **Development:** Env var `ENCRYPTION_MASTER_KEY` (base64-encoded)
2. **Production:** HashiCorp Vault / AWS Secrets Manager / Kubernetes Secret
3. **Rotation:** Versioned key IDs; reencrypt on rotation

```bash
# Generate master key (256 bits = 32 bytes)
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
# → result: copy to .env ENCRYPTION_MASTER_KEY=...

# Usage
export ENCRYPTION_MASTER_KEY=<base64-32-bytes>
npm start
```

**Key Rotation (No Downtime):**

```typescript
// Supports multiple keys for gradual rotation
class KeyStore {
  keys = {
    'KEY-001': Buffer.from(process.env.ENCRYPTION_MASTER_KEY, 'base64'),
    'KEY-002': Buffer.from(process.env.ENCRYPTION_MASTER_KEY_NEW, 'base64'), // new key
  };

  decrypt(payload: string, keyId: string): any {
    const key = this.keys[keyId];
    if (!key) throw new Error(`Unknown keyId: ${keyId}`);
    return new CredentialEncryptor(key).decrypt(payload);
  }

  // Background job: reencrypt all credentials with new key
  async rotateKey(fromKeyId: string, toKeyId: string): Promise<void> {
    const accounts = await db.brokerAccount.findMany({ keyId: fromKeyId });
    for (const account of accounts) {
      const decrypted = this.decrypt(account.credentialsEncrypted, fromKeyId);
      const encryptor = new CredentialEncryptor(this.keys[toKeyId]);
      const { encrypted } = encryptor.encrypt(decrypted);
      await db.brokerAccount.update(
        { id: account.id },
        { credentialsEncrypted: encrypted, keyId: toKeyId },
      );
    }
  }
}
```

### Session Token Management

**Broker provides:** `accessToken` with expiry `expiresAt: 1625097600000`

**SessionManager refresh logic:**

```typescript
export abstract class SessionManager {
  protected sessionToken?: string;
  protected expiresAt: number = 0;

  async ensureActive(): Promise<void> {
    if (this.isTokenExpired()) {
      await this.refreshAccessToken(); // Broker-specific
    }
  }

  protected isTokenExpired(): boolean {
    const buffer = 60 * 1000; // Refresh 1 min before expiry
    return Date.now() + buffer >= this.expiresAt;
  }

  // Background heartbeat (every 30 sec)
  async startHeartbeat(): Promise<void> {
    setInterval(async () => {
      try {
        await this.ensureActive();
      } catch (e) {
        console.error('Heartbeat failed:', e);
        this.circuitBreakerOpen = true;
      }
    }, 30_000);
  }
}
```

**Broker-specific implementations:**

```typescript
// Zerodha OAuth refresh
export class ZerodhaSessionManager extends SessionManager {
  async refreshAccessToken(): Promise<void> {
    const response = await fetch('https://api.zerodha.com/token/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        refresh_token: this.refreshToken,
        client_id: process.env.ZERODHA_CLIENT_ID,
        client_secret: process.env.ZERODHA_CLIENT_SECRET,
      }),
    });
    const data = await response.json();
    this.sessionToken = data.access_token;
    this.expiresAt = Date.now() + data.expires_in * 1000;
  }
}

// Shoonya API key (no refresh, but periodic re-auth)
export class ShoonyaSessionManager extends SessionManager {
  async authenticate(): Promise<void> {
    const response = await fetch('https://api.shoonya.com/user/login', {
      method: 'POST',
      body: `userId=${this.userId}&password=${this.password}&totp=${this.totp}`,
    });
    const data = await response.json();
    this.sessionToken = data.emsg; // Session token
    this.expiresAt = Date.now() + 24 * 60 * 60 * 1000; // 24h expiry
  }
}
```

### Audit Logging

**Log every credential access:**

```typescript
// packages/database/prisma/schema.prisma
model AuditLog {
  id        String   @id @default(uuid())
  actor     String   // User ID or service name
  action    String   // 'CREDENTIAL_ACCESSED', 'CREDENTIAL_CREATED', 'TOKEN_REFRESHED'
  entity    String   // 'BrokerAccount'
  entityId  String   // Account ID
  details   Json?    // Redacted details (no actual credentials)
  status    String   // 'SUCCESS', 'FAILED'
  error     String?  // Error message (non-sensitive)
  createdAt DateTime @default(now())

  @@index([actor, action])
  @@index([entityId])
}
```

**Example audit entry:**

```json
{
  "actor": "auto-trader-service",
  "action": "TOKEN_REFRESHED",
  "entity": "BrokerAccount",
  "entityId": "acc-12345",
  "details": {
    "broker": "ZERODHA",
    "accountId": "***12345", // last 5 digits only
    "newExpiresAt": 1625097600000
  },
  "status": "SUCCESS",
  "createdAt": "2026-06-06T10:00:00Z"
}
```

### Credential Lifecycle

```
1. USER PROVIDES CREDENTIALS
   ↓ (HTTPS only, Helmet + CSP headers)
2. VALIDATE (check format, test connection)
   ↓
3. ENCRYPT (AES-256-GCM)
   ↓
4. STORE (BrokerAccount.credentialsEncrypted)
   ↓
5. SESSION MANAGER USES (decrypted on-demand, never persisted in memory)
   ↓
6. TOKEN REFRESH (if OAuth)
   ↓
7. AUDIT LOG (action logged, credentials redacted)
   ↓
8. ROTATION (periodic key rotation, background job)
```

### Denied Access Patterns

**Never do:**

- [ ] Log plaintext credentials in console/files
- [ ] Store credentials in memory for > 1 request
- [ ] Send credentials in GET query params (use POST body)
- [ ] Cache decrypted credentials across sessions
- [ ] Expose credential fields in API responses
- [ ] Commit encryption keys to git

### Security Checklist

- [ ] AES-256-GCM encryption implemented
- [ ] Master key from env var (production: from Vault)
- [ ] Key rotation supported (no downtime)
- [ ] SessionManager refreshes tokens before expiry
- [ ] Circuit breaker opens on auth failure
- [ ] All credential access audit-logged (redacted)
- [ ] OAuth flows use PKCE (for real brokers)
- [ ] HTTPS enforced (api-gateway: Helmet, CORS)
- [ ] No credentials in logs (redaction filter)
- [ ] No credentials in error messages
- [ ] Credential validation on input (format, length, charset)

### Testing Strategy

```typescript
// packages/broker-sdk/src/common/encryption/credential-encryptor.spec.ts
describe('CredentialEncryptor', () => {
  test('encrypt + decrypt round-trip preserves data', () => {
    const original = { apiKey: 'secret123', userId: 'user1' };
    const { encrypted } = encryptor.encrypt(original);
    const decrypted = encryptor.decrypt(encrypted);
    expect(decrypted).toEqual(original);
  });

  test('different IVs produce different ciphertexts', () => {
    const plaintext = { key: 'same' };
    const { encrypted: c1 } = encryptor.encrypt(plaintext);
    const { encrypted: c2 } = encryptor.encrypt(plaintext);
    expect(c1).not.toEqual(c2); // Different IVs
  });

  test('tampering with ciphertext throws decryption error', () => {
    const { encrypted } = encryptor.encrypt({ key: 'data' });
    const tampered = encrypted.slice(0, -10) + 'corrupted';
    expect(() => encryptor.decrypt(tampered)).toThrow('Unsupported state');
  });
});
```

### Deployment Checklist

- [ ] Set `ENCRYPTION_MASTER_KEY` env var in production
- [ ] Enable Vault integration (or Secrets Manager)
- [ ] Test key rotation flow
- [ ] Verify audit logs capture all access
- [ ] Enable HTTPS on api-gateway
- [ ] Test SessionManager refresh logic
- [ ] Smoke test: login with real broker account (sandbox)

---

**Document Status:** Ready for implementation
