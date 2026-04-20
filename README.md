# Smart Medicine Box

This project is a web-based Smart Medicine Box application with a Node.js/Express backend and Google OAuth login.

## Make it public

You can make the website public by deploying the app to a hosting service that supports Node.js. Two easy free options are:

1. **Render**
2. **Railway**

Both provide a public URL once deployed.

### Recommended deployment flow

#### Option 1: Render

1. Sign up at https://render.com
2. Create a new **Web Service**.
3. Connect your GitHub repository or upload the project.
4. Set the root folder to this project.
5. Use these commands:
   - Build command: `npm install`
   - Start command: `node server.js`
6. Add environment variables in Render:
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   - `GOOGLE_CALLBACK_URL` (your Render URL + `/auth/google/callback`)
   - `SESSION_SECRET`
7. Deploy.
8. Render gives you a public URL like `https://your-app.onrender.com`.

#### Option 2: Railway

1. Sign up at https://railway.app
2. Create a new project and connect your repo.
3. Set the start command to `node server.js`.
4. Add the same environment variables.
5. Deploy and get the public URL.

## Google OAuth settings for a public site

After deployment, update Google Cloud OAuth settings:

- Authorized JavaScript origins:
  - `https://your-public-url`
- Authorized redirect URI:
  - `https://your-public-url/auth/google/callback`

## If you just want a public URL quickly

If you want to test quickly, deploy to Render or Railway and use the free generated subdomain first.

Then update Google Cloud with that exact URL.

## Important note

Do not commit or share your `.env` file. It contains your `GOOGLE_CLIENT_SECRET` and other sensitive settings.

I cannot create the actual public domain or deploy to your account for you, because that requires your login and hosting account access.

But once you deploy, I can help you update the OAuth settings and finish the configuration.
