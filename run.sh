#!/bin/bash

echo "
╔═══════════════════════════════════════════════════════════════════════════════╗
║                    📧 EMAIL CAMPAIGN SYSTEM LAUNCHER                         ║
╚═══════════════════════════════════════════════════════════════════════════════╝
"

# Check if .env is configured
if grep -q "YOUR_GMAIL_ADDRESS_HERE" .env 2>/dev/null; then
    echo "⚠️  GMAIL NOT CONFIGURED!"
    echo ""
    echo "Please edit .env file and replace:"
    echo "• YOUR_GMAIL_ADDRESS_HERE → your actual Gmail address"
    echo "• YOUR_16_CHAR_APP_PASSWORD_HERE → your Gmail App Password"
    echo ""
    echo "Need help? Read SETUP_INSTRUCTIONS.md"
    echo ""
    echo "Then run: npm start"
    exit 1
fi

echo "✅ Configuration looks good!"
echo "🚀 Starting Email Campaign System..."
echo ""

# Start the server
npm start
