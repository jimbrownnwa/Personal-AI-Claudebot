# Morning Briefing Setup Guide

The morning briefing feature automatically sends you a daily summary at 7:00 AM Central Time with:
- 📅 Today's calendar events
- 🌤️ Weather forecast (NW Arkansas / Zip 72756)
- 🤖 Latest AI news
- 🏈 49ers football updates

## Setup Instructions

### 1. Get API Keys

#### OpenWeather API (Free)
1. Visit [openweathermap.org/api](https://openweathermap.org/api)
2. Sign up for a free account
3. Generate an API key
4. Copy the key

#### Perplexity API
1. Visit [perplexity.ai/settings/api](https://www.perplexity.ai/settings/api)
2. Create an API key
3. Copy the key
4. Note: This is a paid service, but very affordable for daily briefings

### 2. Update Your .env File

Add these variables to your `.env` file:

```bash
# Morning Briefing Configuration
TELEGRAM_USER_ID=7740730922
OPENWEATHER_API_KEY=your_openweather_api_key_here
PERPLEXITY_API_KEY=your_perplexity_api_key_here
USER_ZIP_CODE=72756
USER_LOCATION=Northwest Arkansas
```

### 3. Restart Your Bot

```bash
npm run dev
```

## What You'll Get Every Morning at 7 AM

```
☀️ Good Morning!
Saturday, February 8, 2026

📅 Today's Calendar
• 9:00 AM - Team Standup
  📍 Zoom
• 2:00 PM - Product Review
• 5:00 PM - Dinner with friends

🌤️ Weather for Northwest Arkansas
Current: 45°F (feels like 42°F)
Condition: Partly cloudy
Humidity: 65%

Today's Forecast:
High: 52°F | Low: 38°F
Mostly sunny

🤖 AI News
[Latest AI developments, announcements, and breakthroughs from the past 24 hours]

🏈 49ers News
[Latest team news, game results, injuries, and upcoming matchups]

---
Have a great day! 🚀
```

## Customization

### Change the Time

Edit `src/services/scheduled-tasks.service.ts`:

```typescript
// Change '0 7 * * *' to your preferred time
// Format: minute hour day month dayOfWeek
// Examples:
//   '0 6 * * *' = 6:00 AM
//   '30 7 * * *' = 7:30 AM
//   '0 8 * * 1-5' = 8:00 AM Monday-Friday only
morningBriefingTask = cron.schedule('0 7 * * *', ...)
```

### Customize Content

Edit `src/services/morning-briefing.service.ts` to:
- Add/remove sections
- Change news queries
- Modify formatting
- Add additional data sources

### Test It Manually

You can trigger the briefing manually without waiting for 7 AM:

Add this command handler to your bot to test:

```typescript
bot.command('briefing', async (ctx) => {
  await triggerMorningBriefing(bot);
  await ctx.reply('Briefing sent!');
});
```

## Troubleshooting

### Briefing Not Sending

1. Check the logs for errors
2. Verify API keys are correct in `.env`
3. Ensure your server timezone is set correctly
4. Check that the bot process is running at 7 AM

### Missing Sections

If calendar, weather, or news sections are missing:
- Check API key validity
- Verify internet connectivity
- Check API rate limits
- Review logs for specific errors

### Timezone Issues

The cron job uses `America/Chicago` timezone. If you're in a different timezone:

1. Update the timezone in `scheduled-tasks.service.ts`
2. Common timezones:
   - `America/New_York` (Eastern)
   - `America/Chicago` (Central)
   - `America/Denver` (Mountain)
   - `America/Los_Angeles` (Pacific)

## Cost Estimate

- **OpenWeather**: Free (up to 1,000 calls/day)
- **Perplexity**: ~$0.01 per day (2 queries/day)
- **Total**: ~$0.30/month

## Features

- ✅ Runs automatically every day
- ✅ Queries all your Google calendars
- ✅ Real-time weather data
- ✅ Fresh AI and 49ers news
- ✅ Graceful error handling (if one section fails, others still send)
- ✅ Timezone-aware scheduling
