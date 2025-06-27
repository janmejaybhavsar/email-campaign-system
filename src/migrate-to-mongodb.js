// Migration script from SQLite to MongoDB
const { MongoClient } = require('mongodb');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const path = require('path');
const fs = require('fs');

require('dotenv').config();

async function migrate() {
  console.log('🚀 Starting migration from SQLite to MongoDB...\n');

  // Check if SQLite database exists
  const sqlitePath = path.join(__dirname, 'data', 'cold_email_system.db');
  if (!fs.existsSync(sqlitePath)) {
    console.log('❌ No SQLite database found at:', sqlitePath);
    console.log('Nothing to migrate.');
    return;
  }

  // Connect to MongoDB
  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/cold_email_system';
  console.log('🔗 Connecting to MongoDB...');
  
  const client = new MongoClient(mongoUri);
  await client.connect();
  const db = client.db();
  
  console.log('✅ Connected to MongoDB');

  // Open SQLite database
  const sqlite = new sqlite3.Database(sqlitePath, sqlite3.OPEN_READONLY);

  try {
    // Migrate users
    console.log('\n📋 Migrating users...');
    const users = await new Promise((resolve, reject) => {
      sqlite.all('SELECT * FROM users', (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });

    for (const user of users) {
      try {
        await db.collection('users').insertOne({
          name: user.name || user.email.split('@')[0],
          email: user.email,
          passwordHash: user.password_hash,
          signature: user.signature || '',
          gmailAddress: user.gmail_address || null,
          gmailAppPassword: user.gmail_app_password || null,
          gmailConfigured: !!user.gmail_configured,
          gmailVerified: !!user.gmail_verified,
          gmailLastTested: user.gmail_last_tested ? new Date(user.gmail_last_tested) : null,
          createdAt: new Date(user.created_at),
          isActive: !!user.is_active,
          _sqliteId: user.id // Keep reference to old ID
        });
        console.log(`  ✅ Migrated user: ${user.email}`);
      } catch (error) {
        if (error.code === 11000) {
          console.log(`  ⚠️  User already exists: ${user.email}`);
        } else {
          console.error(`  ❌ Failed to migrate user ${user.email}:`, error.message);
        }
      }
    }

    // Get user ID mapping
    const userMapping = {};
    const migratedUsers = await db.collection('users').find({ _sqliteId: { $exists: true } }).toArray();
    migratedUsers.forEach(user => {
      userMapping[user._sqliteId] = user._id;
    });

    // Migrate recipients/contacts
    console.log('\n📋 Migrating contacts...');
    const recipients = await new Promise((resolve, reject) => {
      sqlite.all('SELECT * FROM recipients', (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });

    for (const recipient of recipients) {
      try {
        const userId = userMapping[recipient.user_id];
        if (!userId) {
          console.log(`  ⚠️  Skipping contact ${recipient.email} - user not found`);
          continue;
        }

        await db.collection('contacts').insertOne({
          userId: userId.toString(),
          name: recipient.name,
          email: recipient.email,
          company: recipient.custom_fields ? JSON.parse(recipient.custom_fields).company || '' : '',
          position: recipient.custom_fields ? JSON.parse(recipient.custom_fields).position || '' : '',
          linkedinUrl: recipient.custom_fields ? JSON.parse(recipient.custom_fields).linkedin || '' : '',
          notes: recipient.custom_fields ? JSON.parse(recipient.custom_fields).notes || '' : '',
          customFields: recipient.custom_fields ? JSON.parse(recipient.custom_fields) : {},
          contacted: recipient.status === 'contacted',
          lastContacted: recipient.last_contacted ? new Date(recipient.last_contacted) : null,
          responseReceived: recipient.status === 'replied',
          createdAt: new Date(recipient.created_at),
          _sqliteId: recipient.id
        });
        console.log(`  ✅ Migrated contact: ${recipient.name} (${recipient.email})`);
      } catch (error) {
        if (error.code === 11000) {
          console.log(`  ⚠️  Contact already exists: ${recipient.email}`);
        } else {
          console.error(`  ❌ Failed to migrate contact ${recipient.email}:`, error.message);
        }
      }
    }

    // Get contact ID mapping
    const contactMapping = {};
    const migratedContacts = await db.collection('contacts').find({ _sqliteId: { $exists: true } }).toArray();
    migratedContacts.forEach(contact => {
      contactMapping[contact._sqliteId] = contact._id;
    });

    // Migrate templates
    console.log('\n📋 Migrating templates...');
    const templates = await new Promise((resolve, reject) => {
      sqlite.all('SELECT * FROM templates', (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });

    const templateMapping = {};
    for (const template of templates) {
      try {
        const userId = userMapping[template.user_id];
        if (!userId) {
          console.log(`  ⚠️  Skipping template ${template.name} - user not found`);
          continue;
        }

        const result = await db.collection('templates').insertOne({
          userId: userId.toString(),
          name: template.name,
          subject: template.subject,
          htmlBody: template.html_body,
          textBody: template.text_body || '',
          templateType: template.template_type || 'outreach',
          createdAt: new Date(template.created_at),
          updatedAt: new Date(template.updated_at || template.created_at),
          _sqliteId: template.id
        });
        
        templateMapping[template.id] = result.insertedId;
        console.log(`  ✅ Migrated template: ${template.name}`);
      } catch (error) {
        console.error(`  ❌ Failed to migrate template ${template.name}:`, error.message);
      }
    }

    // Migrate campaigns
    console.log('\n📋 Migrating campaigns...');
    const campaigns = await new Promise((resolve, reject) => {
      sqlite.all('SELECT * FROM campaigns', (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });

    const campaignMapping = {};
    for (const campaign of campaigns) {
      try {
        const userId = userMapping[campaign.user_id];
        const templateId = templateMapping[campaign.template_id];
        
        if (!userId) {
          console.log(`  ⚠️  Skipping campaign ${campaign.name} - user not found`);
          continue;
        }

        const result = await db.collection('campaigns').insertOne({
          userId: userId.toString(),
          name: campaign.name,
          templateId: templateId || campaign.template_id,
          status: campaign.status,
          totalContacts: campaign.total_recipients || 0,
          sentCount: campaign.sent_count || 0,
          repliedCount: campaign.replied_count || 0,
          settings: campaign.settings ? JSON.parse(campaign.settings) : {},
          createdAt: new Date(campaign.created_at),
          _sqliteId: campaign.id
        });
        
        campaignMapping[campaign.id] = result.insertedId;
        console.log(`  ✅ Migrated campaign: ${campaign.name}`);
      } catch (error) {
        console.error(`  ❌ Failed to migrate campaign ${campaign.name}:`, error.message);
      }
    }

    // Migrate email logs
    console.log('\n📋 Migrating email logs...');
    const emailLogs = await new Promise((resolve, reject) => {
      sqlite.all('SELECT * FROM email_logs', (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });

    for (const log of emailLogs) {
      try {
        const campaignId = campaignMapping[log.campaign_id];
        const recipientId = contactMapping[log.recipient_id];
        
        if (!campaignId) {
          console.log(`  ⚠️  Skipping email log - campaign not found`);
          continue;
        }

        await db.collection('emailLogs').insertOne({
          campaignId: campaignId,
          contactId: recipientId || log.recipient_id,
          email: log.email_address,
          status: log.status,
          subject: log.subject,
          notes: log.error_message,
          sentAt: new Date(log.sent_at),
          responseReceived: log.response_received === 1
        });
      } catch (error) {
        console.error(`  ❌ Failed to migrate email log:`, error.message);
      }
    }

    console.log('\n✅ Migration completed successfully!');
    console.log('\n📊 Migration Summary:');
    console.log(`  • Users: ${users.length}`);
    console.log(`  • Contacts: ${recipients.length}`);
    console.log(`  • Templates: ${templates.length}`);
    console.log(`  • Campaigns: ${campaigns.length}`);
    console.log(`  • Email Logs: ${emailLogs.length}`);

    console.log('\n🎯 Next Steps:');
    console.log('  1. Test your application with MongoDB');
    console.log('  2. Once verified, you can delete the old SQLite database');
    console.log('  3. Update your environment variables to use MongoDB in production');

  } catch (error) {
    console.error('\n❌ Migration failed:', error);
  } finally {
    sqlite.close();
    await client.close();
  }
}

// Run migration
migrate().catch(console.error);