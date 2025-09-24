# Ubuntu Server Deployment Guide

This guide will help you deploy the XFGAPI on an Ubuntu server with proper security, SSL, and production-ready configuration.

## Prerequisites

- Ubuntu 20.04+ server
- Root or sudo access
- Domain name (optional but recommended)
- Fuego node and wallet RPC services running

## 1. System Setup

### Update System
```bash
sudo apt update && sudo apt upgrade -y
```

### Install Required Packages
```bash
sudo apt install -y curl wget git nginx certbot python3-certbot-nginx ufw
```

### Install Node.js (LTS)
```bash
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt-get install -y nodejs
```

### Install PM2 (Process Manager)
```bash
sudo npm install -g pm2
```

## 2. Deploy XFGAPI

### Clone Repository
```bash
cd /opt
sudo git clone https://github.com/ColinRitman/xfgapi.git
sudo chown -R $USER:$USER /opt/xfgapi
cd /opt/xfgapi
```

### Install Gateway Dependencies
```bash
cd gateway
npm install --production
```

## 3. Configure Gateway

### Create Environment File
```bash
sudo nano /opt/xfgapi/gateway/.env
```

Add the following configuration:
```env
# Server Configuration
PORT=8787
NODE_ENV=production

# Fuego RPC Configuration
CORE_RPC_URL=http://127.0.0.1:8181
WALLET_RPC_URL=http://127.0.0.1:8070
WALLET_RPC_USER=your_rpc_user
WALLET_RPC_PASSWORD=your_rpc_password

# Security
CORS_ORIGIN=*
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100
```

### Create PM2 Configuration
```bash
sudo nano /opt/xfgapi/gateway/ecosystem.config.js
```

Add the following PM2 configuration:
```javascript
module.exports = {
  apps: [{
    name: 'xfgapi-gateway',
    script: 'server.js',
    cwd: '/opt/xfgapi/gateway',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
      PORT: 8787
    },
    env_file: '.env',
    log_file: '/var/log/xfgapi/gateway.log',
    out_file: '/var/log/xfgapi/gateway-out.log',
    error_file: '/var/log/xfgapi/gateway-error.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
  }]
};
```

## 4. Configure Nginx

### Create Nginx Configuration
```bash
sudo nano /etc/nginx/sites-available/xfgapi
```

Add the following configuration:
```nginx
server {
    listen 80;
    server_name your-domain.com;  # Replace with your domain

    # Rate limiting
    limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;
    limit_req zone=api burst=20 nodelay;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "no-referrer-when-downgrade" always;
    add_header Content-Security-Policy "default-src 'self' http: https: data: blob: 'unsafe-inline'" always;

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        
        # Timeouts
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # Health check endpoint
    location /health {
        access_log off;
        return 200 "healthy\n";
        add_header Content-Type text/plain;
    }
}
```

### Enable Site
```bash
sudo ln -s /etc/nginx/sites-available/xfgapi /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

## 5. Setup SSL with Let's Encrypt

### Get SSL Certificate
```bash
sudo certbot --nginx -d your-domain.com
```

### Auto-renewal
```bash
sudo crontab -e
```

Add this line for automatic renewal:
```bash
0 12 * * * /usr/bin/certbot renew --quiet
```

## 6. Configure Firewall

### Setup UFW
```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow ssh
sudo ufw allow 'Nginx Full'
sudo ufw --force enable
```

## 7. Create Log Directory and Start Services

### Create Log Directory
```bash
sudo mkdir -p /var/log/xfgapi
sudo chown -R $USER:$USER /var/log/xfgapi
```

### Start Gateway with PM2
```bash
cd /opt/xfgapi/gateway
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

## 8. Setup Monitoring

### Install PM2 Monitoring (Optional)
```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
```

### Create Systemd Service (Alternative to PM2)
```bash
sudo nano /etc/systemd/system/xfgapi.service
```

Add the following:
```ini
[Unit]
Description=XFGAPI Gateway
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/opt/xfgapi/gateway
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production
EnvironmentFile=/opt/xfgapi/gateway/.env

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl daemon-reload
sudo systemctl enable xfgapi
sudo systemctl start xfgapi
```

## 9. Health Checks and Monitoring

### Create Health Check Script
```bash
sudo nano /opt/xfgapi/health-check.sh
```

Add the following:
```bash
#!/bin/bash
HEALTH_URL="http://localhost:8787/v1/node/info"
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" $HEALTH_URL)

if [ $RESPONSE -eq 200 ]; then
    echo "$(date): XFGAPI is healthy"
else
    echo "$(date): XFGAPI is unhealthy (HTTP $RESPONSE)"
    # Restart service if needed
    pm2 restart xfgapi-gateway
fi
```

Make executable:
```bash
sudo chmod +x /opt/xfgapi/health-check.sh
```

### Setup Cron Job for Health Checks
```bash
crontab -e
```

Add:
```bash
*/5 * * * * /opt/xfgapi/health-check.sh >> /var/log/xfgapi/health.log 2>&1
```

## 10. Backup and Updates

### Create Backup Script
```bash
sudo nano /opt/xfgapi/backup.sh
```

Add:
```bash
#!/bin/bash
BACKUP_DIR="/opt/backups/xfgapi"
DATE=$(date +%Y%m%d_%H%M%S)

mkdir -p $BACKUP_DIR
tar -czf $BACKUP_DIR/xfgapi_$DATE.tar.gz /opt/xfgapi
find $BACKUP_DIR -name "xfgapi_*.tar.gz" -mtime +7 -delete
```

### Update Script
```bash
sudo nano /opt/xfgapi/update.sh
```

Add:
```bash
#!/bin/bash
cd /opt/xfgapi
git pull origin main
cd gateway
npm install --production
pm2 restart xfgapi-gateway
```

## 11. Testing Deployment

### Test API Endpoints
```bash
# Test node info
curl https://your-domain.com/v1/node/info

# Test node height
curl https://your-domain.com/v1/node/height

# Test wallet balance (if configured)
curl https://your-domain.com/v1/wallet/balance
```

### Check Logs
```bash
# PM2 logs
pm2 logs xfgapi-gateway

# Nginx logs
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log

# Application logs
tail -f /var/log/xfgapi/gateway.log
```

## 12. Security Considerations

### Additional Security Measures
1. **Fail2Ban**: Install and configure to prevent brute force attacks
2. **Regular Updates**: Keep system and dependencies updated
3. **Monitoring**: Set up monitoring with tools like Prometheus/Grafana
4. **Backup Strategy**: Implement regular backups
5. **Access Control**: Use strong passwords and SSH keys

### Environment Security
- Never commit `.env` files to version control
- Use environment-specific configurations
- Implement proper logging and monitoring
- Regular security audits

## Troubleshooting

### Common Issues
1. **Port conflicts**: Ensure ports 80, 443, and 8787 are available
2. **Permission issues**: Check file ownership and permissions
3. **SSL issues**: Verify domain DNS and certificate validity
4. **Service not starting**: Check logs and configuration files

### Useful Commands
```bash
# Check service status
pm2 status
sudo systemctl status xfgapi

# View logs
pm2 logs xfgapi-gateway
sudo journalctl -u xfgapi

# Test nginx configuration
sudo nginx -t

# Check SSL certificate
sudo certbot certificates
```

This deployment guide provides a production-ready setup for the XFGAPI on Ubuntu with proper security, monitoring, and maintenance procedures.
