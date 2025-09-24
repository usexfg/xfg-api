#!/bin/bash

# XFGAPI Ubuntu Server Setup Script
# This script automates the deployment of XFGAPI on Ubuntu servers

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
XFGAPI_DIR="/opt/xfgapi"
DOMAIN=""
EMAIL=""
CORE_RPC_URL="http://127.0.0.1:8181"
WALLET_RPC_URL="http://127.0.0.1:8070"
WALLET_RPC_USER=""
WALLET_RPC_PASSWORD=""

# Functions
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if running as root
check_root() {
    if [[ $EUID -eq 0 ]]; then
        log_error "This script should not be run as root. Please run as a regular user with sudo privileges."
        exit 1
    fi
}

# Get user input
get_config() {
    echo "XFGAPI Ubuntu Setup Script"
    echo "=========================="
    echo
    
    read -p "Enter your domain name (or press Enter to skip SSL): " DOMAIN
    read -p "Enter your email for Let's Encrypt (or press Enter to skip): " EMAIL
    read -p "Enter Core RPC URL [$CORE_RPC_URL]: " input_core_rpc
    CORE_RPC_URL=${input_core_rpc:-$CORE_RPC_URL}
    
    read -p "Enter Wallet RPC URL [$WALLET_RPC_URL]: " input_wallet_rpc
    WALLET_RPC_URL=${input_wallet_rpc:-$WALLET_RPC_URL}
    
    read -p "Enter Wallet RPC Username (optional): " WALLET_RPC_USER
    read -s -p "Enter Wallet RPC Password (optional): " WALLET_RPC_PASSWORD
    echo
}

# Update system
update_system() {
    log_info "Updating system packages..."
    sudo apt update && sudo apt upgrade -y
}

# Install required packages
install_packages() {
    log_info "Installing required packages..."
    sudo apt install -y curl wget git nginx certbot python3-certbot-nginx ufw fail2ban
}

# Install Node.js
install_nodejs() {
    log_info "Installing Node.js LTS..."
    curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
    sudo apt-get install -y nodejs
}

# Install PM2
install_pm2() {
    log_info "Installing PM2..."
    sudo npm install -g pm2
}

# Clone and setup XFGAPI
setup_xfgapi() {
    log_info "Setting up XFGAPI..."
    
    if [ -d "$XFGAPI_DIR" ]; then
        log_warn "XFGAPI directory already exists. Updating..."
        cd "$XFGAPI_DIR"
        git pull origin main
    else
        sudo git clone https://github.com/ColinRitman/xfgapi.git "$XFGAPI_DIR"
        sudo chown -R $USER:$USER "$XFGAPI_DIR"
    fi
    
    cd "$XFGAPI_DIR/gateway"
    npm install --production
}

# Create environment file
create_env() {
    log_info "Creating environment configuration..."
    
    cat > "$XFGAPI_DIR/gateway/.env" << EOF
# Server Configuration
PORT=8787
NODE_ENV=production

# Fuego RPC Configuration
CORE_RPC_URL=$CORE_RPC_URL
WALLET_RPC_URL=$WALLET_RPC_URL
WALLET_RPC_USER=$WALLET_RPC_USER
WALLET_RPC_PASSWORD=$WALLET_RPC_PASSWORD

# Security
CORS_ORIGIN=*
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100
EOF
}

# Create PM2 configuration
create_pm2_config() {
    log_info "Creating PM2 configuration..."
    
    cat > "$XFGAPI_DIR/gateway/ecosystem.config.js" << EOF
module.exports = {
  apps: [{
    name: 'xfgapi-gateway',
    script: 'server.js',
    cwd: '$XFGAPI_DIR/gateway',
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
EOF
}

# Configure Nginx
configure_nginx() {
    log_info "Configuring Nginx..."
    
    # Create log directory
    sudo mkdir -p /var/log/xfgapi
    sudo chown -R $USER:$USER /var/log/xfgapi
    
    # Create Nginx configuration
    sudo tee /etc/nginx/sites-available/xfgapi > /dev/null << EOF
server {
    listen 80;
    server_name $DOMAIN;

    # Rate limiting
    limit_req_zone \$binary_remote_addr zone=api:10m rate=10r/s;
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
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        
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
EOF

    # Enable site
    sudo ln -sf /etc/nginx/sites-available/xfgapi /etc/nginx/sites-enabled/
    sudo nginx -t
    sudo systemctl reload nginx
}

# Setup SSL
setup_ssl() {
    if [ -n "$DOMAIN" ] && [ -n "$EMAIL" ]; then
        log_info "Setting up SSL with Let's Encrypt..."
        sudo certbot --nginx -d "$DOMAIN" --email "$EMAIL" --agree-tos --non-interactive
        
        # Setup auto-renewal
        (crontab -l 2>/dev/null; echo "0 12 * * * /usr/bin/certbot renew --quiet") | crontab -
    else
        log_warn "Skipping SSL setup. Domain or email not provided."
    fi
}

# Configure firewall
configure_firewall() {
    log_info "Configuring firewall..."
    sudo ufw default deny incoming
    sudo ufw default allow outgoing
    sudo ufw allow ssh
    sudo ufw allow 'Nginx Full'
    sudo ufw --force enable
}

# Start services
start_services() {
    log_info "Starting XFGAPI services..."
    
    cd "$XFGAPI_DIR/gateway"
    pm2 start ecosystem.config.js
    pm2 save
    pm2 startup
    
    log_info "Services started successfully!"
}

# Create health check script
create_health_check() {
    log_info "Creating health check script..."
    
    cat > "$XFGAPI_DIR/health-check.sh" << 'EOF'
#!/bin/bash
HEALTH_URL="http://localhost:8787/v1/node/info"
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" $HEALTH_URL)

if [ $RESPONSE -eq 200 ]; then
    echo "$(date): XFGAPI is healthy"
else
    echo "$(date): XFGAPI is unhealthy (HTTP $RESPONSE)"
    pm2 restart xfgapi-gateway
fi
EOF

    chmod +x "$XFGAPI_DIR/health-check.sh"
    
    # Add to crontab
    (crontab -l 2>/dev/null; echo "*/5 * * * * $XFGAPI_DIR/health-check.sh >> /var/log/xfgapi/health.log 2>&1") | crontab -
}

# Main execution
main() {
    check_root
    get_config
    
    log_info "Starting XFGAPI Ubuntu setup..."
    
    update_system
    install_packages
    install_nodejs
    install_pm2
    setup_xfgapi
    create_env
    create_pm2_config
    configure_nginx
    setup_ssl
    configure_firewall
    start_services
    create_health_check
    
    log_info "XFGAPI setup completed successfully!"
    echo
    echo "Next steps:"
    echo "1. Ensure your Fuego node and wallet RPC services are running"
    echo "2. Test the API: curl http://localhost:8787/v1/node/info"
    if [ -n "$DOMAIN" ]; then
        echo "3. Test with SSL: curl https://$DOMAIN/v1/node/info"
    fi
    echo "4. Monitor logs: pm2 logs xfgapi-gateway"
    echo "5. Check status: pm2 status"
    echo
    echo "Configuration files:"
    echo "- Environment: $XFGAPI_DIR/gateway/.env"
    echo "- PM2 Config: $XFGAPI_DIR/gateway/ecosystem.config.js"
    echo "- Nginx Config: /etc/nginx/sites-available/xfgapi"
    echo
}

# Run main function
main "$@"
