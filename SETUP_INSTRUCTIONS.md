# 📧 Email Campaign System - Setup Instructions

## 🚀 Quick Setup (5 minutes)

### Step 1: Configure Gmail
1. **Enable 2-Factor Authentication** on your Google Account
   - Go to: https://myaccount.google.com/security
   - Enable 2-Step Verification if not already enabled

2. **Create App Password**
   - Still in Security settings
   - Click "2-Step Verification"
   - Scroll down to "App passwords"
   - Select app: "Mail"
   - Select device: "Other (custom name)"
   - Enter: "Email Campaign System"
   - **Copy the 16-character password!**

### Step 2: Configure System
1. **Edit .env file**
   ```
   nano .env
   ```

2. **Replace these values:**
   ```
   SMTP_USERNAME=your-actual-gmail@gmail.com
   SMTP_PASSWORD=your-16-char-app-password
   SMTP_FROM_EMAIL=your-actual-gmail@gmail.com
   ```

3. **Save the file**

### Step 3: Start System
```bash
npm start
```

### Step 4: Test Everything
```bash
# In another terminal
npm test
```

### Step 5: Use the System
1. Open: http://localhost:3000
2. Login: test@example.com / TestPassword123!
3. Add your email as a recipient
4. Create a template
5. Send a campaign!

## 🎯 What You Can Do

✅ **Send personalized emails** with {{name}}, {{email}}, custom fields  
✅ **Bulk import recipients** from CSV  
✅ **Create email templates** with HTML and plain text  
✅ **Send campaigns** with configurable delays  
✅ **Track delivery** and campaign performance  
✅ **Handle unsubscribes** automatically  
✅ **Manage multiple campaigns** and templates  

## 🔧 Troubleshooting

### Email Not Sending?
- Check Gmail App Password is correct (16 characters with spaces)
- Verify 2FA is enabled on Google Account
- Make sure Gmail address is correct in .env

### Can't Login?
- Use test credentials: test@example.com / TestPassword123!
- Or register a new account in the web interface

### Port Already in Use?
- Change PORT in .env to 3001
- Or kill the process: `sudo lsof -ti:3000 | xargs kill -9`

### Database Issues?
- Delete ./data/email_campaigns.db and restart
- System will recreate the database automatically

## 📊 System Status

- **Database**: SQLite (./data/email_campaigns.db)
- **Email Service**: Gmail SMTP
- **Frontend**: http://localhost:3000
- **API**: http://localhost:3000/api
- **Health Check**: http://localhost:3000/health

## 🛡️ Security Features

- JWT authentication
- Password hashing with bcrypt
- Rate limiting (100 requests per 15 minutes)
- Input validation
- SQL injection prevention
- Secure headers with Helmet.js

## 📈 Production Ready

This system can handle:
- **1000+ recipients** per campaign
- **Multiple concurrent users**
- **Campaign scheduling** and automation
- **Real-time delivery tracking**
- **Comprehensive logging**
- **Automatic unsubscribe handling**

Need help? Check the server console for detailed error messages!
