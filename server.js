// =============================================================================
// PROFESSIONAL COLD EMAIL SYSTEM FOR JOB APPLICATIONS
// Clean, personal emails without campaign branding
// =============================================================================

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

console.log('🚀 Starting Professional Cold Email System...');

// =============================================================================
// MIDDLEWARE
// =============================================================================

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

// Conservative rate limiting for professional use
const limiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 50 // 50 emails per hour max (professional sending rate)
});
app.use(limiter);

// =============================================================================
// DATABASE SETUP
// =============================================================================

['./data', './logs'].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

const db = new sqlite3.Database('./data/cold_email_system.db', (err) => {
  if (err) {
    console.error('❌ Database connection failed:', err);
    process.exit(1);
  }
  console.log('✅ Connected to SQLite database');
});

// Initialize database tables (removed unsubscribe tables)
db.serialize(() => {
  const tables = [
    `CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      signature TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      is_active BOOLEAN DEFAULT 1
    )`,
    `CREATE TABLE IF NOT EXISTS contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      name TEXT,
      email TEXT NOT NULL,
      company TEXT,
      position TEXT,
      linkedin_url TEXT,
      notes TEXT,
      custom_fields JSON,
      contacted BOOLEAN DEFAULT 0,
      last_contacted DATETIME,
      response_received BOOLEAN DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users (id),
      UNIQUE(user_id, email)
    )`,
    `CREATE TABLE IF NOT EXISTS templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      name TEXT NOT NULL,
      subject TEXT NOT NULL,
      html_body TEXT,
      text_body TEXT,
      template_type TEXT DEFAULT 'outreach', -- 'outreach', 'follow_up', 'thank_you'
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users (id)
    )`,
    `CREATE TABLE IF NOT EXISTS outreach_campaigns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      name TEXT NOT NULL,
      template_id INTEGER,
      status TEXT DEFAULT 'draft',
      total_contacts INTEGER DEFAULT 0,
      sent_count INTEGER DEFAULT 0,
      replied_count INTEGER DEFAULT 0,
      settings JSON,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users (id),
      FOREIGN KEY (template_id) REFERENCES templates (id)
    )`,
    `CREATE TABLE IF NOT EXISTS email_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER,
      contact_id INTEGER,
      email TEXT NOT NULL,
      status TEXT NOT NULL,
      subject TEXT,
      sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      response_received BOOLEAN DEFAULT 0,
      notes TEXT,
      FOREIGN KEY (campaign_id) REFERENCES outreach_campaigns (id),
      FOREIGN KEY (contact_id) REFERENCES contacts (id)
    )`,
    `CREATE TABLE IF NOT EXISTS email_tracking (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id INTEGER,
    contact_id INTEGER,
    email TEXT NOT NULL,
    tracking_id TEXT UNIQUE NOT NULL,
    opened BOOLEAN DEFAULT 0,
    opened_at DATETIME,
    clicked BOOLEAN DEFAULT 0,
    clicked_at DATETIME,
    clicks_count INTEGER DEFAULT 0,
    user_agent TEXT,
    ip_address TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (campaign_id) REFERENCES outreach_campaigns (id),
    FOREIGN KEY (contact_id) REFERENCES contacts (id)
  )`,
    `CREATE TABLE IF NOT EXISTS tracked_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tracking_id TEXT NOT NULL,
    original_url TEXT NOT NULL,
    clicked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    user_agent TEXT,
    ip_address TEXT,
    FOREIGN KEY (tracking_id) REFERENCES email_tracking (tracking_id)
  )`
  ];

  tables.forEach((sql, index) => {
    db.run(sql, (err) => {
      if (err) {
        console.error(`❌ Error creating table ${index + 1}:`, err);
      }
    });
  });

  console.log('✅ Database tables initialized');
});

// =============================================================================
// EMAIL SERVICE SETUP
// =============================================================================

let emailTransporter = null;

async function initializeEmailService() {
  try {
    if (!process.env.SMTP_USERNAME || process.env.SMTP_USERNAME === 'YOUR_GMAIL_ADDRESS_HERE') {
      console.log('⚠️  Gmail not configured in .env file');
      return false;
    }

    console.log('🔧 Configuring professional email service...');
    console.log(`📧 Your email: ${process.env.SMTP_USERNAME}`);

    emailTransporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USERNAME,
        pass: process.env.SMTP_PASSWORD
      },
      tls: {
        rejectUnauthorized: false
      }
    });

    await emailTransporter.verify();
    console.log('✅ Professional email service ready!');
    return true;
  } catch (error) {
    console.log('❌ Email service connection failed:', error.message);
    return false;
  }
}

// =============================================================================
// AUTHENTICATION
// =============================================================================

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid token' });
    }
    req.user = user;
    next();
  });
};

// =============================================================================
// API ROUTES
// =============================================================================

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    emailServiceConnected: !!emailTransporter,
    environment: process.env.NODE_ENV || 'development',
    baseUrl: BASE_URL
  });
});

// Authentication with name field
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password, signature } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email and password required' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    db.run(
      'INSERT INTO users (name, email, password_hash, signature) VALUES (?, ?, ?, ?)',
      [name, email, hashedPassword, signature || ''],
      function (err) {
        if (err) {
          if (err.code === 'SQLITE_CONSTRAINT') {
            return res.status(409).json({ error: 'User already exists' });
          }
          return res.status(500).json({ error: 'Registration failed' });
        }

        const token = jwt.sign(
          { userId: this.lastID, email, name },
          process.env.JWT_SECRET,
          { expiresIn: '24h' }
        );

        console.log(`✅ User registered: ${name} (${email})`);
        res.status(201).json({
          message: 'Account created successfully',
          token,
          user: { id: this.lastID, name, email, signature }
        });
      }
    );
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    db.get(
      'SELECT * FROM users WHERE email = ? AND is_active = 1',
      [email],
      async (err, user) => {
        if (err) {
          return res.status(500).json({ error: 'Login failed' });
        }

        if (!user || !await bcrypt.compare(password, user.password_hash)) {
          return res.status(401).json({ error: 'Invalid credentials' });
        }

        const token = jwt.sign(
          { userId: user.id, email: user.email, name: user.name },
          process.env.JWT_SECRET,
          { expiresIn: '24h' }
        );

        console.log(`✅ User logged in: ${user.name} (${user.email})`);
        res.json({
          message: 'Login successful',
          token,
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            signature: user.signature
          }
        });
      }
    );
  } catch (error) {
    res.status(500).json({ error: 'Login failed' });
  }
});

// Contacts management
app.post('/api/contacts', authenticateToken, (req, res) => {
  const { name, email, company, position, linkedinUrl, notes, customFields } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  db.run(
    'INSERT OR REPLACE INTO contacts (user_id, name, email, company, position, linkedin_url, notes, custom_fields) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [req.user.userId, name || '', email, company || '', position || '', linkedinUrl || '', notes || '', JSON.stringify(customFields || {})],
    function (err) {
      if (err) {
        return res.status(500).json({ error: 'Failed to add contact' });
      }
      console.log(`✅ Contact added: ${name} (${email}) at ${company}`);
      res.status(201).json({ message: 'Contact added', id: this.lastID });
    }
  );
});

app.get('/api/contacts', authenticateToken, (req, res) => {
  db.all(
    'SELECT * FROM contacts WHERE user_id = ? ORDER BY created_at DESC',
    [req.user.userId],
    (err, contacts) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to get contacts' });
      }
      res.json({
        contacts: contacts.map(c => ({
          ...c,
          custom_fields: JSON.parse(c.custom_fields || '{}')
        })),
        pagination: { total: contacts.length }
      });
    }
  );
});

// Templates
app.post('/api/templates', authenticateToken, (req, res) => {
  const { name, subject, htmlBody, textBody, templateType } = req.body;

  if (!name || !subject || !htmlBody) {
    return res.status(400).json({ error: 'Name, subject, and body are required' });
  }

  db.run(
    'INSERT INTO templates (user_id, name, subject, html_body, text_body, template_type) VALUES (?, ?, ?, ?, ?, ?)',
    [req.user.userId, name, subject, htmlBody, textBody || '', templateType || 'outreach'],
    function (err) {
      if (err) {
        return res.status(500).json({ error: 'Failed to create template' });
      }
      console.log(`✅ Template created: ${name}`);
      res.status(201).json({ message: 'Template created', id: this.lastID });
    }
  );
});

app.get('/api/templates', authenticateToken, (req, res) => {
  db.all(
    'SELECT * FROM templates WHERE user_id = ? ORDER BY created_at DESC',
    [req.user.userId],
    (err, templates) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to get templates' });
      }
      res.json(templates);
    }
  );
});

// Get single template for editing
app.get('/api/templates/:id', authenticateToken, (req, res) => {
  const templateId = req.params.id;

  db.get(
    'SELECT * FROM templates WHERE id = ? AND user_id = ?',
    [templateId, req.user.userId],
    (err, template) => {
      if (err) {
        console.error('Get template error:', err);
        return res.status(500).json({ error: 'Failed to get template' });
      }

      if (!template) {
        return res.status(404).json({ error: 'Template not found' });
      }

      res.json(template);
    }
  );
});

// Update template
app.put('/api/templates/:id', authenticateToken, (req, res) => {
  const templateId = req.params.id;
  const { name, subject, htmlBody, textBody, templateType } = req.body;

  if (!name || !subject || !htmlBody) {
    return res.status(400).json({ error: 'Name, subject, and body are required' });
  }

  db.run(
    'UPDATE templates SET name = ?, subject = ?, html_body = ?, text_body = ?, template_type = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?',
    [name, subject, htmlBody, textBody || '', templateType || 'outreach', templateId, req.user.userId],
    function (err) {
      if (err) {
        console.error('Update template error:', err);
        return res.status(500).json({ error: 'Failed to update template' });
      }

      if (this.changes === 0) {
        return res.status(404).json({ error: 'Template not found' });
      }

      console.log(`✅ Template updated: ${name} (ID: ${templateId})`);
      res.json({ message: 'Template updated successfully', id: templateId });
    }
  );
});

// Delete template
app.delete('/api/templates/:id', authenticateToken, (req, res) => {
  const templateId = req.params.id;

  db.run(
    'DELETE FROM templates WHERE id = ? AND user_id = ?',
    [templateId, req.user.userId],
    function (err) {
      if (err) {
        console.error('Delete template error:', err);
        return res.status(500).json({ error: 'Failed to delete template' });
      }

      if (this.changes === 0) {
        return res.status(404).json({ error: 'Template not found' });
      }

      console.log(`✅ Template deleted: ID ${templateId}`);
      res.json({ message: 'Template deleted successfully' });
    }
  );
});

// Outreach campaigns
app.post('/api/campaigns', authenticateToken, (req, res) => {
  const { name, templateId, settings } = req.body;

  if (!name || !templateId) {
    return res.status(400).json({ error: 'Name and template are required' });
  }

  db.run(
    'INSERT INTO outreach_campaigns (user_id, name, template_id, settings) VALUES (?, ?, ?, ?)',
    [req.user.userId, name, templateId, JSON.stringify(settings || {})],
    function (err) {
      if (err) {
        return res.status(500).json({ error: 'Failed to create campaign' });
      }
      console.log(`✅ Outreach campaign created: ${name}`);
      res.status(201).json({ message: 'Campaign created', id: this.lastID });
    }
  );
});

app.get('/api/campaigns', authenticateToken, (req, res) => {
  db.all(
    `SELECT c.*, t.name as template_name 
     FROM outreach_campaigns c 
     LEFT JOIN templates t ON c.template_id = t.id 
     WHERE c.user_id = ? 
     ORDER BY c.created_at DESC`,
    [req.user.userId],
    (err, campaigns) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to get campaigns' });
      }
      res.json(campaigns.map(c => ({
        ...c,
        settings: JSON.parse(c.settings || '{}')
      })));
    }
  );
});

// Send professional outreach campaign
app.post('/api/campaigns/:id/send', authenticateToken, async (req, res) => {
  const campaignId = req.params.id;

  console.log(`🔍 Attempting to send campaign ID: ${campaignId} for user: ${req.user.userId}`);

  if (!emailTransporter) {
    return res.status(500).json({
      error: 'Email service not configured. Please check your Gmail settings.'
    });
  }

  try {
    // First, let's check if the campaign exists
    const campaignCheck = await new Promise((resolve, reject) => {
      db.get(
        'SELECT * FROM outreach_campaigns WHERE id = ? AND user_id = ?',
        [campaignId, req.user.userId],
        (err, row) => {
          if (err) {
            console.error('Campaign check error:', err);
            reject(err);
          } else {
            console.log('Campaign check result:', row);
            resolve(row);
          }
        }
      );
    });

    if (!campaignCheck) {
      console.log(`❌ Campaign ${campaignId} not found for user ${req.user.userId}`);
      return res.status(404).json({ error: 'Campaign not found' });
    }

    // Get template info
    const template = await new Promise((resolve, reject) => {
      db.get(
        'SELECT * FROM templates WHERE id = ? AND user_id = ?',
        [campaignCheck.template_id, req.user.userId],
        (err, row) => {
          if (err) {
            console.error('Template check error:', err);
            reject(err);
          } else {
            console.log('Template check result:', row);
            resolve(row);
          }
        }
      );
    });

    if (!template) {
      console.log(`❌ Template ${campaignCheck.template_id} not found`);
      return res.status(404).json({ error: 'Template not found' });
    }

    // Get user info
    const user = await new Promise((resolve, reject) => {
      db.get(
        'SELECT * FROM users WHERE id = ?',
        [req.user.userId],
        (err, row) => {
          if (err) {
            console.error('User check error:', err);
            reject(err);
          } else {
            console.log('User check result:', row);
            resolve(row);
          }
        }
      );
    });

    if (!user) {
      console.log(`❌ User ${req.user.userId} not found`);
      return res.status(404).json({ error: 'User not found' });
    }

    // Combine all the data
    const campaign = {
      ...campaignCheck,
      subject: template.subject,
      html_body: template.html_body,
      text_body: template.text_body,
      template_name: template.name,
      user_name: user.name,
      signature: user.signature
    };

    console.log('✅ Campaign data prepared:', {
      id: campaign.id,
      name: campaign.name,
      template_name: campaign.template_name,
      user_name: campaign.user_name
    });

    // Get contacts that haven't been contacted yet
    const contacts = await new Promise((resolve, reject) => {
      db.all(
        'SELECT * FROM contacts WHERE user_id = ? AND contacted = 0',
        [req.user.userId],
        (err, rows) => {
          if (err) {
            console.error('Contacts check error:', err);
            reject(err);
          } else {
            console.log(`Found ${rows.length} contacts to reach out to`);
            resolve(rows);
          }
        }
      );
    });

    if (contacts.length === 0) {
      return res.status(400).json({ error: 'No new contacts to reach out to. All contacts have already been contacted.' });
    }

    // Update campaign status
    db.run(
      'UPDATE outreach_campaigns SET status = ?, total_contacts = ? WHERE id = ?',
      ['sending', contacts.length, campaignId],
      (err) => {
        if (err) {
          console.error('Campaign update error:', err);
        } else {
          console.log(`✅ Campaign ${campaignId} status updated to sending`);
        }
      }
    );

    // Start sending emails asynchronously
    setTimeout(() => sendProfessionalEmailsWithTracking(campaignId, campaign, contacts), 100);

    console.log(`🚀 Outreach campaign "${campaign.name}" started - reaching out to ${contacts.length} contacts`);
    res.json({
      message: 'Outreach campaign started!',
      totalContacts: contacts.length,
      campaignName: campaign.name
    });

  } catch (error) {
    console.error('❌ Send campaign error:', error);
    res.status(500).json({ error: 'Failed to start campaign: ' + error.message });
  }
});

// Email tracking
// Tracking pixel endpoint (tracks email opens)
app.get('/track/open/:trackingId', (req, res) => {
  const trackingId = req.params.trackingId;
  const userAgent = req.get('User-Agent');
  const ipAddress = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'];

  console.log(`📊 Email opened - Tracking ID: ${trackingId}`);

  // Update tracking record
  db.run(
    'UPDATE email_tracking SET opened = 1, opened_at = CURRENT_TIMESTAMP, user_agent = ?, ip_address = ? WHERE tracking_id = ? AND opened = 0',
    [userAgent, ipAddress, trackingId],
    function (err) {
      if (err) {
        console.error('Tracking update error:', err);
      } else if (this.changes > 0) {
        console.log(`✅ Email open tracked: ${trackingId}`);
      }
    }
  );

  // Return 1x1 transparent pixel
  const pixel = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64'
  );

  res.set({
    'Content-Type': 'image/png',
    'Content-Length': pixel.length,
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0'
  });

  res.send(pixel);
});

// Link click tracking endpoint
app.get('/track/click/:trackingId/:linkIndex', (req, res) => {
  const { trackingId, linkIndex } = req.params;
  const userAgent = req.get('User-Agent');
  const ipAddress = req.ip || req.connection.remoteAddress;

  console.log(`🔗 Link clicked - Tracking ID: ${trackingId}, Link: ${linkIndex}`);

  // Get the original URL
  db.get(
    'SELECT original_url FROM tracked_links WHERE tracking_id = ? AND id = ?',
    [trackingId, linkIndex],
    (err, link) => {
      if (err || !link) {
        console.error('Link tracking error:', err);
        return res.status(404).send('Link not found');
      }

      // Log the click
      db.run(
        'INSERT INTO tracked_links (tracking_id, original_url, user_agent, ip_address) VALUES (?, ?, ?, ?)',
        [trackingId, link.original_url, userAgent, ipAddress]
      );

      // Update tracking record
      db.run(
        'UPDATE email_tracking SET clicked = 1, clicked_at = CURRENT_TIMESTAMP, clicks_count = clicks_count + 1 WHERE tracking_id = ?',
        [trackingId],
        function (err) {
          if (err) {
            console.error('Click tracking update error:', err);
          } else {
            console.log(`✅ Link click tracked: ${trackingId}`);

            // Update campaign stats
            db.run(`
              UPDATE outreach_campaigns 
              SET clicked_count = (
                SELECT COUNT(DISTINCT tracking_id) FROM email_tracking 
                WHERE campaign_id = (
                  SELECT campaign_id FROM email_tracking WHERE tracking_id = ?
                ) AND clicked = 1
              )
              WHERE id = (
                SELECT campaign_id FROM email_tracking WHERE tracking_id = ?
              )
            `, [trackingId, trackingId]);
          }
        }
      );

      // Redirect to original URL
      res.redirect(link.original_url);
    }
  );
});

// Campaign Analytics
// Get detailed campaign analytics including tracking data
app.get('/api/campaigns/:id/analytics', authenticateToken, (req, res) => {
  const campaignId = req.params.id;

  // Verify campaign ownership
  db.get(
    'SELECT * FROM outreach_campaigns WHERE id = ? AND user_id = ?',
    [campaignId, req.user.userId],
    (err, campaign) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }

      if (!campaign) {
        return res.status(404).json({ error: 'Campaign not found' });
      }

      // Get detailed tracking analytics
      const queries = [
        // Basic email logs
        new Promise((resolve, reject) => {
          db.all(
            'SELECT status, COUNT(*) as count FROM email_logs WHERE campaign_id = ? GROUP BY status',
            [campaignId],
            (err, rows) => err ? reject(err) : resolve(rows)
          );
        }),

        // Tracking data
        new Promise((resolve, reject) => {
          db.all(
            `SELECT 
               COUNT(*) as total_tracked,
               COUNT(CASE WHEN opened = 1 THEN 1 END) as opened,
               COUNT(CASE WHEN clicked = 1 THEN 1 END) as clicked,
               SUM(clicks_count) as total_clicks
             FROM email_tracking 
             WHERE campaign_id = ?`,
            [campaignId],
            (err, rows) => err ? reject(err) : resolve(rows[0] || {})
          );
        }),

        // Individual contact tracking
        new Promise((resolve, reject) => {
          db.all(
            `SELECT 
               c.name, c.email, c.company, c.position,
               et.opened, et.opened_at, et.clicked, et.clicked_at, et.clicks_count
             FROM email_tracking et
             JOIN contacts c ON et.contact_id = c.id
             WHERE et.campaign_id = ?
             ORDER BY et.created_at DESC`,
            [campaignId],
            (err, rows) => err ? reject(err) : resolve(rows)
          );
        })
      ];

      Promise.all(queries)
        .then(([emailLogs, trackingStats, contactTracking]) => {
          const emailStats = emailLogs.reduce((acc, stat) => {
            acc[stat.status] = stat.count;
            return acc;
          }, {});

          const analytics = {
            campaign: {
              id: campaign.id,
              name: campaign.name,
              status: campaign.status,
              total_contacts: campaign.total_contacts,
              sent_count: campaign.sent_count,
              created_at: campaign.created_at
            },
            emailStats: {
              sent: emailStats.sent || 0,
              failed: emailStats.failed || 0
            },
            trackingStats: {
              totalTracked: trackingStats.total_tracked || 0,
              opened: trackingStats.opened || 0,
              clicked: trackingStats.clicked || 0,
              totalClicks: trackingStats.total_clicks || 0,
              openRate: trackingStats.total_tracked > 0 ?
                Math.round((trackingStats.opened / trackingStats.total_tracked) * 100) : 0,
              clickRate: trackingStats.total_tracked > 0 ?
                Math.round((trackingStats.clicked / trackingStats.total_tracked) * 100) : 0
            },
            contactTracking: contactTracking.map(contact => ({
              ...contact,
              opened_at: contact.opened_at ? new Date(contact.opened_at).toISOString() : null,
              clicked_at: contact.clicked_at ? new Date(contact.clicked_at).toISOString() : null
            }))
          };

          res.json(analytics);
        })
        .catch(error => {
          console.error('Analytics error:', error);
          res.status(500).json({ error: 'Failed to fetch analytics' });
        });
    }
  );
});

// Get all campaigns with summary analytics
app.get('/api/campaigns/analytics/summary', authenticateToken, (req, res) => {
  db.all(
    `SELECT 
       c.id, c.name, c.status, c.total_contacts, c.sent_count, c.created_at,
       COUNT(et.id) as tracked_emails,
       COUNT(CASE WHEN et.opened = 1 THEN 1 END) as opens,
       COUNT(CASE WHEN et.clicked = 1 THEN 1 END) as clicks
     FROM outreach_campaigns c
     LEFT JOIN email_tracking et ON c.id = et.campaign_id
     WHERE c.user_id = ?
     GROUP BY c.id
     ORDER BY c.created_at DESC`,
    [req.user.userId],
    (err, campaigns) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to get campaign analytics' });
      }

      const analyticsData = campaigns.map(campaign => ({
        ...campaign,
        openRate: campaign.tracked_emails > 0 ?
          Math.round((campaign.opens / campaign.tracked_emails) * 100) : 0,
        clickRate: campaign.tracked_emails > 0 ?
          Math.round((campaign.clicks / campaign.tracked_emails) * 100) : 0
      }));

      res.json(analyticsData);
    }
  );
});

// =============================================================================
// PROFESSIONAL EMAIL SENDING FUNCTION
// =============================================================================

async function sendProfessionalEmailsWithTracking(campaignId, campaign, contacts) {
  const settings = JSON.parse(campaign.settings || '{}');
  const delay = settings.delay || 30000;

  let sentCount = 0;
  let failedCount = 0;

  console.log(`📧 Starting tracked professional outreach to ${contacts.length} contacts...`);

  for (let i = 0; i < contacts.length; i++) {
    const contact = contacts[i];

    try {
      // Generate unique tracking ID
      const trackingId = uuidv4();

      // Create tracking record
      await new Promise((resolve, reject) => {
        db.run(
          'INSERT INTO email_tracking (campaign_id, contact_id, email, tracking_id) VALUES (?, ?, ?, ?)',
          [campaignId, contact.id, contact.email, trackingId],
          (err) => err ? reject(err) : resolve()
        );
      });

      // Personalize content
      const personalizedSubject = personalizeContent(campaign.subject, contact, campaign);
      let personalizedHtml = personalizeContent(campaign.html_body, contact, campaign);
      const personalizedText = personalizeContent(campaign.text_body, contact, campaign);

      // Add tracking pixel to HTML
      const trackingPixel = `<img src="${BASE_URL}/track/open/${trackingId}" width="1" height="1" style="display:none;" alt="">`;

      // Process links for click tracking
      personalizedHtml = await processLinksForTracking(personalizedHtml, trackingId);

      // Add tracking pixel at the end
      personalizedHtml += trackingPixel;

      // Add professional signature if available
      if (campaign.signature) {
        personalizedHtml += '<br><br>' + campaign.signature.replace(/\n/g, '<br>');
      }

      console.log(`📤 Sending tracked email to: ${contact.name} (${contact.email})`);

      // Send email
      const emailResult = await emailTransporter.sendMail({
        from: `"${campaign.user_name}" <${process.env.SMTP_FROM_EMAIL}>`,
        to: contact.email,
        subject: personalizedSubject,
        html: personalizedHtml,
        text: personalizedText + (campaign.signature ? '\n\n' + campaign.signature : ''),
        headers: {
          'Reply-To': process.env.SMTP_FROM_EMAIL,
          'X-Priority': '3',
          'X-Mailer': 'Personal'
        }
      });

      // Mark contact as contacted
      await new Promise((resolve, reject) => {
        db.run(
          'UPDATE contacts SET contacted = 1, last_contacted = CURRENT_TIMESTAMP WHERE id = ?',
          [contact.id],
          (err) => err ? reject(err) : resolve()
        );
      });

      // Log the outreach
      await logOutreach(campaignId, contact.id, contact.email, 'sent', personalizedSubject);
      sentCount++;

      console.log(`✅ ${sentCount}/${contacts.length} - Tracked email sent to: ${contact.name} (${contact.email})`);

      // Professional delay between emails
      if (delay > 0 && i < contacts.length - 1) {
        console.log(`⏳ Waiting ${delay / 1000} seconds before next email...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }

    } catch (error) {
      console.error(`❌ Failed to send email to ${contact.email}:`, error);
      await logOutreach(campaignId, contact.id, contact.email, 'failed', '', error.message);
      failedCount++;
    }
  }

  // Update campaign completion
  await new Promise((resolve, reject) => {
    db.run(
      'UPDATE outreach_campaigns SET status = ?, sent_count = ? WHERE id = ?',
      ['completed', sentCount, campaignId],
      (err) => err ? reject(err) : resolve()
    );
  });

  console.log(`🎉 Professional outreach campaign completed with tracking!`);
  console.log(`   ✅ Successfully sent: ${sentCount}`);
  console.log(`   ❌ Failed: ${failedCount}`);
  console.log(`   📊 Success rate: ${Math.round((sentCount / contacts.length) * 100)}%`);
  console.log(`   🔍 All emails are now tracked for opens and clicks`);
}

// Function to process links for click tracking
async function processLinksForTracking(htmlContent, trackingId) {
  const linkRegex = /<a\s+(?:[^>]*?\s+)?href\s*=\s*["']([^"']+)["'][^>]*>(.*?)<\/a>/gi;
  let linkIndex = 0;
  const trackedLinks = [];

  const processedHtml = htmlContent.replace(linkRegex, (match, url, linkText) => {
    linkIndex++;

    // Store original URL for tracking
    trackedLinks.push({
      index: linkIndex,
      originalUrl: url,
      trackingId: trackingId
    });

    // Create tracking URL
    const trackingUrl = `${BASE_URL}/track/click/${trackingId}/${linkIndex}`;

    // Return modified link
    return `<a href="${trackingUrl}">${linkText}</a>`;
  });

  // Store tracked links in database
  for (const link of trackedLinks) {
    await new Promise((resolve, reject) => {
      db.run(
        'INSERT INTO tracked_links (tracking_id, original_url) VALUES (?, ?)',
        [link.trackingId, link.originalUrl],
        (err) => err ? reject(err) : resolve()
      );
    });
  }

  return processedHtml;
}

function personalizeContent(content, contact, campaign) {
  if (!content) return '';

  const customFields = JSON.parse(contact.custom_fields || '{}');

  let personalized = content
    .replace(/\{\{name\}\}/g, contact.name || 'there')
    .replace(/\{\{firstName\}\}/g, contact.name ? contact.name.split(' ')[0] : 'there')
    .replace(/\{\{email\}\}/g, contact.email)
    .replace(/\{\{company\}\}/g, contact.company || 'your company')
    .replace(/\{\{position\}\}/g, contact.position || 'your role')
    .replace(/\{\{linkedin\}\}/g, contact.linkedin_url || '')
    .replace(/\{\{myName\}\}/g, campaign.user_name || '');

  // Handle custom fields
  personalized = personalized.replace(/\{\{([^}]+)\}\}/g, (match, key) => {
    return customFields[key] || match;
  });

  return personalized;
}

async function logOutreach(campaignId, contactId, email, status, subject, notes = null) {
  return new Promise((resolve, reject) => {
    db.run(
      'INSERT INTO email_logs (campaign_id, contact_id, email, status, subject, notes) VALUES (?, ?, ?, ?, ?, ?)',
      [campaignId, contactId, email, status, subject, notes],
      (err) => {
        if (err) {
          console.error('Error logging outreach:', err);
          reject(err);
        } else {
          console.log(`📝 Logged outreach: ${email} - ${status}`);
          resolve();
        }
      }
    );
  });
}

// =============================================================================
// BULK CONTACT IMPORT
// =============================================================================

app.post('/api/contacts/bulk', authenticateToken, (req, res) => {
  const { contacts } = req.body;

  if (!Array.isArray(contacts)) {
    return res.status(400).json({ error: 'Contacts must be an array' });
  }

  const stmt = db.prepare(
    'INSERT OR REPLACE INTO contacts (user_id, name, email, company, position, linkedin_url, notes, custom_fields) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );

  let successCount = 0;
  let errorCount = 0;

  contacts.forEach(contact => {
    stmt.run([
      req.user.userId,
      contact.name || '',
      contact.email,
      contact.company || '',
      contact.position || '',
      contact.linkedinUrl || '',
      contact.notes || '',
      JSON.stringify(contact.customFields || {})
    ], (err) => {
      if (err) {
        errorCount++;
      } else {
        successCount++;
      }
    });
  });

  stmt.finalize((err) => {
    if (err) throw err;
    console.log(`✅ Bulk import: ${successCount} contacts added`);
    res.json({
      message: 'Bulk import completed',
      successful: successCount,
      errors: errorCount
    });
  });
});

// Serve frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// =============================================================================
// START SERVER
// =============================================================================

async function startServer() {
  console.log('🔧 Initializing professional email service...');
  const emailReady = await initializeEmailService();

  const server = app.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════════════════════════════════════════════╗
║                    💼 PROFESSIONAL COLD EMAIL SYSTEM                         ║
╠═══════════════════════════════════════════════════════════════════════════════╣
║  Web Interface: http://localhost:${PORT}                                        ║
║  Database: ./data/cold_email_system.db                                       ║
║  Email Service: ${emailReady ? '✅ Ready for Professional Outreach' : '❌ Configure Gmail'}              ║
║                                                                               ║
║  ${emailReady ? '🎯 Ready to send professional cold emails!' : '⚠️  Configure Gmail in .env to start outreach'}          ║
╚═══════════════════════════════════════════════════════════════════════════════╝

💼 PROFESSIONAL COLD EMAIL FEATURES:
   ✅ Personal sender name (appears from you, not a system)
   ✅ No unsubscribe links or campaign branding
   ✅ Professional sending rate (30s delays)
   ✅ Contact management with company/position
   ✅ Personalized templates with {{name}}, {{company}}, etc.
   ✅ Response tracking and follow-up management

🎯 BEST PRACTICES:
   • Keep emails personal and relevant
   • Research your contacts before reaching out
   • Use professional subject lines
   • Include your real contact information
   • Follow up appropriately (not too frequently)
   • Be genuine about your interest in the role/company
    `);
  });

  return server;
}

startServer().catch(error => {
  console.error('❌ Failed to start server:', error);
  process.exit(1);
});

// Add graceful shutdown handling:
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  if (emailTransporter) {
    emailTransporter.close();
  }
  db.close((err) => {
    if (err) {
      console.error('Error closing database:', err);
    } else {
      console.log('Database connection closed');
    }
    process.exit(0);
  });
});