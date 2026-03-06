# MayaMind Deployment Guide

Deploy MayaMind to companion.mayamind.ai on Ubuntu 24.04 LTS with Nginx and systemd.

## Prerequisites

- Ubuntu 24.04 LTS VPS with root/sudo access
- Domain: mayamind.ai with DNS access
- Node.js 20.x or later
- Nginx installed
- Certbot installed

---

## Step 1: DNS Configuration

Add an A record in your domain registrar's DNS settings:

| Type | Name | Value | TTL |
|------|------|-------|-----|
| A | companion | YOUR_VPS_IP_ADDRESS | 300 |

Wait for DNS propagation (usually 5-15 minutes). Verify with:
```bash
dig companion.mayamind.ai +short
```

---

## Step 2: Prepare the VPS

SSH into your VPS:
```bash
ssh root@YOUR_VPS_IP
```

### Install Node.js 20.x (if not already installed)
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node --version  # Should show v20.x.x
```

### Install ffmpeg (required for voice message conversion)
```bash
sudo apt-get install -y ffmpeg
ffmpeg -version
```

### Create application directory
```bash
sudo mkdir -p /var/www/mayamind
sudo chown www-data:www-data /var/www/mayamind
```

---

## Step 3: Upload Application Code

From your local machine, upload the code:

### Option A: Using rsync (recommended)
```bash
cd ~/venv/mayamind-poc
rsync -avz --exclude 'node_modules' --exclude '.env' --exclude '.git' \
  ./ root@YOUR_VPS_IP:/var/www/mayamind/
```

### Option B: Using scp
```bash
cd ~/venv/mayamind-poc
tar --exclude='node_modules' --exclude='.env' --exclude='.git' -czf mayamind.tar.gz .
scp mayamind.tar.gz root@YOUR_VPS_IP:/tmp/
ssh root@YOUR_VPS_IP "cd /var/www/mayamind && tar -xzf /tmp/mayamind.tar.gz"
```

### Option C: Using Git
```bash
ssh root@YOUR_VPS_IP
cd /var/www/mayamind
git clone git@github.com:vjnadkarni/mayamind-poc.git .
```

---

## Step 4: Install Dependencies

```bash
cd /var/www/mayamind/server
sudo -u www-data npm install --production
```

---

## Step 5: Configure Environment Variables

Create the .env file:
```bash
sudo nano /var/www/mayamind/.env
```

Paste the contents from `deploy/env.production.template` and fill in your actual API keys:

```env
PORT=3001
NODE_ENV=production
ANTHROPIC_API_KEY=sk-ant-...
ELEVENLABS_API_KEY=...
ELEVENLABS_VOICE_ID=21m00Tcm4TlvDq8ikWAM
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_WHATSAPP_NUMBER=whatsapp:+14155238886
NGROK_URL=https://companion.mayamind.ai
```

Secure the file:
```bash
sudo chown www-data:www-data /var/www/mayamind/.env
sudo chmod 600 /var/www/mayamind/.env
```

---

## Step 6: Set Up Systemd Service

Copy the service file:
```bash
sudo cp /var/www/mayamind/deploy/mayamind.service /etc/systemd/system/
```

Enable and start the service:
```bash
sudo systemctl daemon-reload
sudo systemctl enable mayamind
sudo systemctl start mayamind
```

Check status:
```bash
sudo systemctl status mayamind
sudo journalctl -u mayamind -f  # View logs
```

---

## Step 7: Configure Nginx

Copy the Nginx configuration:
```bash
sudo cp /var/www/mayamind/deploy/nginx-companion.conf /etc/nginx/sites-available/companion.mayamind.ai
```

Enable the site:
```bash
sudo ln -s /etc/nginx/sites-available/companion.mayamind.ai /etc/nginx/sites-enabled/
```

Test Nginx configuration:
```bash
sudo nginx -t
```

Reload Nginx:
```bash
sudo systemctl reload nginx
```

---

## Step 8: Obtain SSL Certificate

Run Certbot to get a Let's Encrypt certificate:
```bash
sudo certbot --nginx -d companion.mayamind.ai
```

Follow the prompts:
- Enter email address for renewal notices
- Agree to terms of service
- Choose whether to redirect HTTP to HTTPS (recommended: Yes)

Certbot will automatically:
- Obtain the certificate
- Update your Nginx configuration
- Set up auto-renewal

Verify auto-renewal:
```bash
sudo certbot renew --dry-run
```

---

## Step 9: Configure WhatsApp (Twilio)

### Option A: Production WhatsApp Business Number (Recommended)

For a permanent WhatsApp Business number without sandbox limitations:

1. Follow the guide in `docs/CONFIGURE_TWILIO_WHATSAPP_NUMBER.md`
2. Update `.env` with your production number:
   ```
   TWILIO_WHATSAPP_NUMBER=whatsapp:+1YOURNUMBER
   ```
3. Restart: `sudo systemctl restart mayamind`

### Option B: Twilio Sandbox (Development Only)

For quick testing with the sandbox:

1. Go to Twilio Console → Messaging → Try it out → Send a WhatsApp message
2. In Sandbox Settings, update the webhook URL:
   - **When a message comes in**: `https://companion.mayamind.ai/api/whatsapp/webhook`
   - Method: POST
3. Note: Sandbox requires users to opt-in every 72 hours

---

## Step 10: Verify Deployment

1. Visit https://companion.mayamind.ai/dashboard/
2. Verify the landing page appears with the image slideshow
3. Tap to enter the dashboard
4. Test each section:
   - Maya Conversation: Speak to Maya
   - Exercise Guidance: Start an exercise session
   - Health Monitoring: Check mock data displays
   - Connect: Test WhatsApp messaging (if Twilio configured)

---

## Useful Commands

### Service Management
```bash
sudo systemctl status mayamind    # Check status
sudo systemctl restart mayamind   # Restart
sudo systemctl stop mayamind      # Stop
sudo systemctl start mayamind     # Start
```

### View Logs
```bash
sudo journalctl -u mayamind -f           # Live logs
sudo journalctl -u mayamind --since today # Today's logs
sudo journalctl -u mayamind -n 100       # Last 100 lines
```

### Nginx
```bash
sudo nginx -t                     # Test configuration
sudo systemctl reload nginx       # Reload configuration
sudo tail -f /var/log/nginx/companion.mayamind.ai.error.log
```

### Update Application
```bash
cd /var/www/mayamind
sudo -u www-data git pull         # If using git
sudo systemctl restart mayamind
```

---

## Troubleshooting

### 502 Bad Gateway
- Check if MayaMind service is running: `sudo systemctl status mayamind`
- Check logs: `sudo journalctl -u mayamind -n 50`
- Verify port 3001 is listening: `sudo ss -tlnp | grep 3001`

### SSL Certificate Issues
- Check certificate status: `sudo certbot certificates`
- Force renewal: `sudo certbot renew --force-renewal`

### Permission Issues
- Fix ownership: `sudo chown -R www-data:www-data /var/www/mayamind`
- Fix .env permissions: `sudo chmod 600 /var/www/mayamind/.env`

### Node.js Issues
- Check Node version: `node --version` (should be 20.x)
- Reinstall dependencies: `cd /var/www/mayamind/server && rm -rf node_modules && npm install`
