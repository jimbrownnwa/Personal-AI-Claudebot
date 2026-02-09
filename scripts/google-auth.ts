/**
 * Google OAuth Authentication Helper
 * Run this script to authenticate with Google and save tokens
 */

import { google } from 'googleapis';
import http from 'http';
import url from 'url';
import open from 'open';
import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';

dotenv.config();

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events',
];

const TOKEN_PATH = path.join(process.cwd(), 'google-token.json');

async function authenticate() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:8080/callback';

  if (!clientId || !clientSecret) {
    console.error('❌ Google credentials not found in .env file');
    console.error('Please add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to your .env file');
    process.exit(1);
  }

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

  // Generate auth URL
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
  });

  console.log('\n🔐 Google OAuth Authentication\n');
  console.log('Opening browser for authentication...\n');
  console.log('If browser doesn\'t open, visit this URL:\n');
  console.log(authUrl, '\n');

  // Create local server to receive callback
  const server = http.createServer(async (req, res) => {
    if (req.url?.indexOf('/callback') > -1) {
      const qs = new url.URL(req.url, 'http://localhost:8080').searchParams;
      const code = qs.get('code');

      if (code) {
        res.end('✅ Authentication successful! You can close this window.');

        try {
          const { tokens } = await oauth2Client.getToken(code);
          await fs.writeFile(TOKEN_PATH, JSON.stringify(tokens, null, 2));

          console.log('\n✅ Success! Google tokens saved to google-token.json');
          console.log('\nYou can now start your bot with: npm start\n');

          server.close();
          process.exit(0);
        } catch (error) {
          console.error('\n❌ Error saving tokens:', error);
          server.close();
          process.exit(1);
        }
      } else {
        res.end('❌ Authentication failed: No code received');
        server.close();
        process.exit(1);
      }
    }
  });

  server.listen(8080, () => {
    open(authUrl);
  });
}

authenticate().catch(console.error);
