# XFGAPI - Fuego Blockchain API Suite

A comprehensive REST API layer over the Fuego Network and Wallet RPCs with multi-language client SDKs for easy integration.

## 🚀 Features

- **REST API Gateway** - Node.js gateway that translates REST calls to Fuego RPC endpoints
- **Multi-Language Support** - Client SDKs for 10+ programming languages
- **OpenAPI Specification** - Complete API documentation with Swagger/OpenAPI 3.0
- **Production Ready** - Privacy-focused server with comprehensive security analysis

## 📦 Available Client SDKs

| Language | Client Directory | Description |
|----------|-----------------|-------------|
| **JavaScript/Node.js** | [`clients/javascript/`](./clients/javascript/) | Browser and Node.js compatible client |
| **Python** | [`clients/python/`](./clients/python/) | Python client with requests library |
| **Go** | [`clients/go/`](./clients/go/) | Go client with full type safety |
| **Java** | [`clients/java/`](./clients/java/) | Java client with Maven/Gradle support |
| **C# (.NET)** | [`clients/csharp/`](./clients/csharp/) | .NET client with NuGet package |
| **PHP** | [`clients/php/`](./clients/php/) | PHP client with Composer support |
| **Ruby** | [`clients/ruby/`](./clients/ruby/) | Ruby client with Gem support |
| **Kotlin** | [`clients/kotlin/`](./clients/kotlin/) | Kotlin client for Android/JVM |
| **Swift 5** | [`clients/swift5/`](./clients/swift5/) | Swift client for iOS/macOS |
| **Rust** | [`clients/rust/`](./clients/rust/) | Rust client with Cargo support |

## 🏗️ Architecture

- **Gateway REST base**: `http://localhost:8787/v1`
- **Underlying services**:
  - Core RPC: `CORE_RPC_URL` (default `http://127.0.0.1:8181`)
  - Wallet RPC: `WALLET_RPC_URL` (default `http://127.0.0.1:8070`)
  - Wallet auth (optional): `WALLET_RPC_USER`, `WALLET_RPC_PASSWORD`

## 🚀 Quick Start

### 1. Start the Gateway Server

The gateway server is located in [`gateway/`](./gateway/) directory.

```bash
cd gateway
npm install
CORE_RPC_URL=http://127.0.0.1:8181 \
WALLET_RPC_URL=http://127.0.0.1:8070 \
WALLET_RPC_USER=rpcuser \
WALLET_RPC_PASSWORD=rpcpass \
PORT=8787 \
node server.js
```

**Prerequisites**: Start fuegod and Wallet RPC servers locally.

### 2. Test the API

Test the gateway with these example requests:

**Node Information**
```bash
curl http://localhost:8787/v1/node/info
```

**Node Height**
```bash
curl http://localhost:8787/v1/node/height
```

**Wallet Balance**
```bash
curl http://localhost:8787/v1/wallet/balance
```

**Wallet Transfer**
```bash
curl -X POST http://localhost:8787/v1/wallet/transfer \
  -H 'Content-Type: application/json' \
  -d '{
    "destinations": [{"address": "fire...", "amount": 1000000}],
    "payment_id": "",
    "mixin": 0,
    "unlock_time": 0,
    "messages": [],
    "ttl": 0
  }'
```

## 📚 Using Client SDKs

### JavaScript/Node.js Client

Navigate to [`clients/javascript/`](./clients/javascript/) and follow the README:

```bash
cd clients/javascript
npm install
```

### Python Client

Navigate to [`clients/python/`](./clients/python/) and follow the README:

```bash
pip install requests
```

### Other Languages

Each client SDK has its own directory with specific installation and usage instructions:

- **Go**: [`clients/go/`](./clients/go/) - `go mod tidy && go run main.go`
- **Java**: [`clients/java/`](./clients/java/) - `mvn install` or `./gradlew build`
- **C#**: [`clients/csharp/`](./clients/csharp/) - `dotnet build` or `nuget restore`
- **PHP**: [`clients/php/`](./clients/php/) - `composer install`
- **Ruby**: [`clients/ruby/`](./clients/ruby/) - `bundle install`
- **Kotlin**: [`clients/kotlin/`](./clients/kotlin/) - `./gradlew build`
- **Swift**: [`clients/swift5/`](./clients/swift5/) - `swift build`
- **Rust**: [`clients/rust/`](./clients/rust/) - `cargo build`

## 📖 API Documentation

### OpenAPI Specification

The complete API specification is available at [`openapi/fuego-openapi.yaml`](./openapi/fuego-openapi.yaml).

**Import into your favorite API client:**
- **Postman**: Import the OpenAPI YAML file
- **Insomnia**: Import the OpenAPI YAML file  
- **Swagger UI**: Use the YAML file with Swagger UI
- **VS Code**: Use the REST Client extension

### Generate New SDKs

Use the SDK generation script to create clients for additional languages:

```bash
cd openapi
./generate_sdks.sh
```

## 🔒 Security & Privacy

### Privacy-Focused Server

A privacy-enhanced version of the gateway server is available at [`gateway/server-privacy.js`](./gateway/server-privacy.js).

### Security Analysis

Comprehensive privacy and security analysis is documented in [`privacy-security/privacy-analysis.md`](./privacy-security/privacy-analysis.md).

## 🔗 Explorer Integration

Integration tools for blockchain explorers are available in [`explorer-integration/`](./explorer-integration/):

- Migration scripts for existing explorers
- Integration documentation
- Setup guides

## 🏭 Production Deployment

### Ubuntu Server Deployment

For production deployment on Ubuntu servers, we provide comprehensive guides and automated setup:

#### 🚀 Quick Setup (Automated)
```bash
# Download and run the automated setup script
curl -fsSL https://raw.githubusercontent.com/ColinRitman/xfgapi/main/scripts/ubuntu-setup.sh | bash
```

#### 📖 Manual Setup Guide
For detailed manual setup instructions, see [`docs/UBUNTU-DEPLOYMENT.md`](./docs/UBUNTU-DEPLOYMENT.md).

#### 🛠️ What the Setup Includes
- **Nginx reverse proxy** with SSL/TLS termination
- **PM2 process management** for automatic restarts
- **Let's Encrypt SSL certificates** with auto-renewal
- **UFW firewall** configuration
- **Rate limiting** and security headers
- **Health monitoring** and logging
- **Fail2ban** protection against brute force attacks

### Docker Deployment

For containerized deployments, use the provided Docker configuration:

```bash
# Build and run with Docker Compose
docker-compose up -d
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `CORE_RPC_URL` | Core RPC server URL | `http://127.0.0.1:8181` |
| `WALLET_RPC_URL` | Wallet RPC server URL | `http://127.0.0.1:8070` |
| `WALLET_RPC_USER` | Wallet RPC username | (optional) |
| `WALLET_RPC_PASSWORD` | Wallet RPC password | (optional) |
| `PORT` | Gateway server port | `8787` |
| `NODE_ENV` | Node.js environment | `production` |
| `CORS_ORIGIN` | CORS allowed origins | `*` |

### Production Checklist

- ✅ **SSL/TLS encryption** configured
- ✅ **Reverse proxy** (Nginx) setup
- ✅ **Process management** (PM2) configured
- ✅ **Firewall** rules applied
- ✅ **Rate limiting** enabled
- ✅ **Security headers** configured
- ✅ **Monitoring** and logging setup
- ✅ **Backup strategy** implemented
- ✅ **Health checks** automated

## 📄 License

This project is licensed under the terms specified in the LICENSE file.

## 🤝 Contributing

Contributions are welcome! Please see the contributing guidelines for more information.

---

**Repository**: [https://github.com/ColinRitman/xfgapi](https://github.com/ColinRitman/xfgapi)
