#!/bin/bash

echo "
╔═══════════════════════════════════════════════════════════════════════════════╗
║                    📧 PROFESSIONAL COLD EMAIL SYSTEM                         ║
║                        MongoDB + Individual Gmail                            ║
╚═══════════════════════════════════════════════════════════════════════════════╝
"

# Check if .env exists
if [ ! -f .env ]; then
    echo "⚠️  .ENV FILE NOT FOUND!"
    echo ""
    echo "Creating .env file from template..."
    
    cat > .env << 'EOF'
# Professional Cold Email System Configuration
NODE_ENV=development
PORT=3000

# MongoDB Configuration (REQUIRED)
# For local: mongodb://localhost:27017/cold_email_system
# For Atlas: mongodb+srv://user:pass@cluster.mongodb.net/cold_email_system
MONGODB_URI=mongodb://localhost:27017/cold_email_system

# JWT Secret for authentication
JWT_SECRET=your_very_secure_jwt_secret_here_minimum_32_characters

# Base URL for email tracking
BASE_URL=http://localhost:3000

# Logging level
LOG_LEVEL=info
EOF
    
    echo "✅ Created .env file with default configuration"
    echo ""
fi

# Check if MongoDB URI is configured
if grep -q "mongodb://localhost:27017" .env 2>/dev/null; then
    echo "📋 Using LOCAL MongoDB configuration"
    echo "   • Make sure MongoDB is running locally"
    echo "   • Or update MONGODB_URI in .env for Atlas"
elif grep -q "mongodb+srv://" .env 2>/dev/null; then
    echo "☁️  Using MongoDB Atlas configuration"
    echo "   • Make sure your Atlas cluster is running"
    echo "   • Verify IP address is whitelisted"
else
    echo "⚠️  MONGODB NOT CONFIGURED!"
    echo ""
    echo "Please edit .env file and set MONGODB_URI to either:"
    echo "• Local:  mongodb://localhost:27017/cold_email_system"
    echo "• Atlas:  mongodb+srv://user:pass@cluster.mongodb.net/cold_email_system"
    echo ""
    echo "For free MongoDB Atlas: https://cloud.mongodb.com"
    echo ""
    exit 1
fi

# Check Node.js version
NODE_VERSION=$(node -v 2>/dev/null | cut -d'v' -f2 | cut -d'.' -f1)
if [ -z "$NODE_VERSION" ]; then
    echo "❌ Node.js not found! Please install Node.js 16+"
    exit 1
elif [ "$NODE_VERSION" -lt 16 ]; then
    echo "⚠️  Node.js version $NODE_VERSION detected. Recommended: 16+"
fi

echo ""
echo "✅ Configuration looks good!"
echo "🚀 Starting Professional Cold Email System..."
echo ""
echo "📖 SETUP PROCESS:"
echo "   1. System will start at http://localhost:3000"
echo "   2. Register for an account"
echo "   3. Configure your Gmail in Settings tab"
echo "   4. Add contacts and create templates"
echo "   5. Send professional cold emails!"
echo ""
echo "🔐 GMAIL CONFIGURATION:"
echo "   • Each user configures their own Gmail"
echo "   • Requires Gmail App Password (not regular password)"
echo "   • Emails sent from user's personal Gmail account"
echo ""

# Start the server
npm start