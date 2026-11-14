// what the hero demo says: every bot, its chat so far, the suggestions under it and the scripted answer to each. the
// capture (capture/capture.mjs) plays all of it into the real app and keeps the rows the app draws, so the demo shows
// the app's own markup; demo.js only decides when each row appears.
//   { u } a person's message, { b } a reply in markdown, { file: { name, mime } } a file the bot shared with the reply
//   before it, { card } a question card, { tool } a step it took (the app keeps those out of the chat)
//   steps: what the working line says while the bot works, before "Typing…"
export const MODELS = {
  sonnet: { instanceId: 'claude', model: 'claude-sonnet-5' },
  opus: { instanceId: 'claude', model: 'claude-opus-5-5' },
  gpt: { instanceId: 'codex', model: 'gpt-6.1-terra' },
  gemini: { instanceId: 'antigravity', model: 'gemini-3.8-flash' },
  grok: { instanceId: 'grok', model: 'grok-4.7' },
};

export const BOTS = [
  {
    key: 'dusk', name: 'dusk bot', main: true, color: 'chrome', body: 'kit', model: 'sonnet',
    routines: [{ name: 'Morning brief', time: '08:00', weekdays: [1, 2, 3, 4, 5], enabled: true }, { name: 'Friday wrap-up', time: '17:00', weekdays: [5], enabled: false }],
    history: [
      { u: 'Morning. What did everyone do overnight?' },
      { b: "Good morning. Here's what the team did:\n\n| Bot | Did | Needs you |\n| --- | --- | --- |\n| Inbox | Sorted 63 emails, drafted 4 replies | 2 to approve |\n| Researcher | Compared 3 CRMs | No |\n| Bookkeeper | Closed October | 3 subscriptions |\n| Coder | Fixed checkout on Safari | No |" },
      { b: 'Priya moved your 11:30 to 2:00. I updated your calendar and told her that works.' },
    ],
    chips: [
      { u: 'Plan my day', steps: ['Reading your calendar', 'Checking your inbox'], tool: ['Read', { file_path: 'calendar/today.ics' }],
        reply: [{ b: "Here's a plan that keeps your morning clear:\n\n| Time | What |\n| --- | --- |\n| 9:00 | Approve 2 replies (10 min) |\n| 9:30 | Pitch deck, no meetings |\n| 12:00 | Lunch |\n| 2:00 | Priya |\n| 4:00 | Review the checkout fix |\n\nWant me to decline the optional 4:30 sync so you finish early?" }] },
      { u: 'Remind me to call mom at 6', steps: ['Working on it'],
        reply: [{ b: "Done. I'll message you at 6 PM: \"Call mom.\" It's on your calendar too, so your phone will ping." }] },
      { u: 'What can you do?', steps: ['Thinking it through'],
        reply: [{ b: "I'm your main bot. I have a computer of my own, so I can do what you'd do at a desk: browse, fill in forms, write, sort email, run code.\n\nI also hand work to the right teammate. Research goes to Researcher, money to Bookkeeper, code to Coder, and I tell you when it's done." }] },
    ],
  },
  {
    key: 'researcher', name: 'Researcher', color: 'purple', body: 'hoot', model: 'gpt',
    routines: [{ name: 'Competitor watch', time: '09:00', weekdays: [1], enabled: true }],
    history: [
      { u: 'Find me a CRM for a team of 5. Under $30 a seat, and it has to work with Gmail.' },
      { b: "Three fit. Here's how they compare:\n\n| Tool | Per seat | Gmail | Reviews |\n| --- | --- | --- | --- |\n| Hatch | $20 | Yes | 4.7 (180) |\n| Plainsight | $24 | Yes | 4.5 (2,310) |\n| Roster | $29 | Yes | 4.6 (240) |\n\nI'd pick **Hatch**. Cheapest, simplest, and reviewers keep saying setup took an afternoon." },
      { file: { name: 'crm-shortlist.csv', mime: 'text/csv' } },
    ],
    chips: [
      { u: 'Compare 3 laptops under $1,000', steps: ['Searching for laptops under $1,000', 'Digging around'], tool: ['WebSearch', { query: 'best laptop under $1000' }],
        reply: [{ b: "For everyday work, these three are the best value right now:\n\n| Laptop | Price | Battery | Weight |\n| --- | --- | --- | --- |\n| Lumen 14 | $899 | 15 h | 1.3 kg |\n| Corvo Air | $949 | 18 h | 1.2 kg |\n| Nimbus 13 | $799 | 11 h | 1.4 kg |\n\nCorvo Air if battery matters most. Nimbus 13 if you want to save $150 and mostly work at a desk." }] },
      { u: 'What do customers say about us?', steps: ['Digging around', 'Putting it together'], tool: ['WebFetch', { url: 'https://reviews.example/us' }],
        reply: [{ b: "I read 212 reviews from the last 90 days. The short version:\n\n- **Loved:** fast shipping (48 mentions) and packaging (31)\n- **Disliked:** the app keeps logging people out (27)\n- **Asked for:** gift cards (12)\n\nFixing login would cover most of the 1 and 2 star reviews." }, { file: { name: 'review-themes.md', mime: 'text/markdown' } }] },
    ],
  },
  {
    key: 'writer', name: 'Content Writer', color: 'pink', body: 'mochi', model: 'opus',
    routines: [{ name: 'Newsletter draft', time: '10:00', weekdays: [4], enabled: true }],
    history: [
      { u: 'Write a LinkedIn post about our new same-day delivery. Short, no hype.' },
      { b: "Here's a draft:\n\n> Starting Monday, orders placed before 2 PM arrive the same day, anywhere in the city. We tested it for six weeks with 300 customers, and 94% of orders landed before 7 PM. It's free over $40." },
      { u: 'Love it. Instagram version too?' },
      { b: 'Order by 2 PM, get it tonight. Same-day delivery is live across the city, free over $40.' },
    ],
    chips: [
      { u: 'Write a welcome email', steps: ['Putting it together'],
        reply: [{ b: "Here's a welcome email:\n\n> **Subject:** You're in\n>\n> Hi Sam, thanks for your first order. It ships today, and you'll get a tracking link the moment it leaves. If anything's off, just reply to this email. A real person reads every one." }] },
      { u: 'Give me 5 blog ideas', steps: ['Mulling it over'],
        reply: [{ b: "Five ideas, picked from what your customers ask about most:\n\n1. How we pack a mug so it never breaks\n2. Same-day delivery: what happens after you click buy\n3. 3 ways to style one ceramic set\n4. Why we stopped using plastic tape\n5. A day with one of our drivers\n\nThe packing one should do best, it's the top question in your reviews." }] },
    ],
  },
  {
    key: 'inbox', name: 'Inbox', color: 'blue', body: 'pip', model: 'gemini', unread: true,
    routines: [{ name: 'Morning sort', time: '07:00', weekdays: [0, 1, 2, 3, 4, 5, 6], enabled: true }, { name: 'Unsubscribe sweep', time: '09:00', weekdays: [1], enabled: false }],
    history: [
      { u: 'What came in overnight?' },
      { b: "63 new emails. 51 were newsletters and receipts, so I filed them. These need you:\n\n| From | About | Status |\n| --- | --- | --- |\n| Priya S. | Moving 11:30 to 2:00 | Accepted |\n| Daniel (landlord) | Lease renewal, due Friday | Draft ready |\n| Sam | Final logo files | Saved to Drive |" },
      { u: 'Send the reply to Daniel' },
      { b: "Sent. I'll tell you when he answers." },
    ],
    chips: [
      { u: 'What did I miss today?', steps: ['Checking your inbox', 'Putting it together'], tool: ['Read', { file_path: 'inbox/today.json' }],
        reply: [{ b: "Since this morning, 9 new emails. Only two matter:\n\n- **Daniel** agreed to keep the rent the same. He'll send the lease Monday.\n- **Sam** asked if Thursday works for the launch call.\n\nThe rest were receipts and newsletters, all filed." }] },
      { u: 'Unsubscribe me from the junk', steps: ['Clicking around', 'Working in Gmail'],
        reply: [{ b: "Done. I unsubscribed you from 14 lists you haven't opened in 60 days, like the shoe store and the three webinar ones. I kept your bank, school and anything with a receipt." }] },
    ],
  },
  {
    key: 'maya', name: 'Maya', color: 'green', body: 'sprout', model: 'sonnet',
    routines: [{ name: 'Sunday meal plan', time: '17:00', weekdays: [0], enabled: true }],
    history: [
      { u: 'Plan dinners for this week. 4 people, Ana is vegetarian, nothing over 40 minutes.' },
      { b: "Here's the week:\n\n| Day | Dinner | Time |\n| --- | --- | --- |\n| Mon | Lemon chickpea pasta | 25 min |\n| Tue | Tacos, bean ones for Ana | 30 min |\n| Wed | Halloumi tray bake | 35 min |\n| Thu | Leftovers night | 0 min |\n| Fri | Homemade pizza | 40 min |\n\nEverything is in your grocery cart: 23 items, about $86. It's not ordered yet." },
      { file: { name: 'meal-plan.pdf', mime: 'application/pdf' } },
    ],
    chips: [
      { u: 'Order the groceries', steps: ['Clicking around', 'Placing the order'],
        reply: [{ b: 'Ordered. Delivery is Tuesday between 6 and 7 PM, total $84.60. The store was out of halloumi, so I swapped in paneer. It works the same in the tray bake.' }] },
      { u: 'Find a dentist open on Saturday', steps: ['Searching for dentists open Saturday', 'Digging around'], tool: ['WebSearch', { query: 'dentist open saturday near me' }],
        reply: [{ b: "Two near you have Saturday slots:\n\n| Clinic | Slot | Distance |\n| --- | --- | --- |\n| Harbor Dental | 10:15 AM | 1.2 km |\n| Elm Street Dental | 1:30 PM | 2.5 km |\n\nHarbor Dental takes your insurance. Want me to book 10:15?" }] },
    ],
  },
  {
    key: 'books', name: 'Bookkeeper', color: 'orange', body: 'loaf', model: 'gpt', waiting: true,
    routines: [{ name: 'Monthly close', time: '09:00', weekdays: [1], enabled: true }, { name: 'Receipt check', time: '16:00', weekdays: [5], enabled: true }],
    history: [
      { u: 'How did October go?' },
      { b: "Good month. Profit is up 43%, mostly from the new wholesale orders.\n\n| | October | September |\n| --- | --- | --- |\n| Revenue | $18,420 | $15,910 |\n| Costs | $11,230 | $10,870 |\n| Profit | $7,190 | $5,040 |" },
      { file: { name: 'october-close.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' } },
      { card: { title: 'Cancel them?', subtitle: "Three subscriptions you haven't opened in 60 days cost $89 a month together.", options: ['Yes, cancel all three', 'Not yet'] } },
    ],
    // the card's choices are the suggestions here
    answers: {
      'Yes, cancel all three': { steps: ['Working in Stripe', 'Cancelling subscriptions'], reply: [{ b: "Cancelled all three. That's $89 a month, or $1,068 a year. I saved the confirmation emails in Receipts in case you need them back." }] },
      'Not yet': { steps: ['Working on it'], reply: [{ b: "No problem, they stay. I'll ask again on the 1st if you still haven't opened them." }] },
    },
    chips: [
      { u: 'How much tax should I set aside?', steps: ['Thinking it through'],
        reply: [{ b: "Based on this year's profit so far, set aside about **$2,150** from October. I used the same 30% you saved last quarter. Want me to move it to your tax savings account on the 1st each month?" }] },
    ],
  },
  {
    key: 'coder', name: 'Coder', color: 'cyan', body: 'boxo', model: 'opus',
    routines: [{ name: 'Nightly tests', time: '02:00', weekdays: [0, 1, 2, 3, 4, 5, 6], enabled: true }],
    history: [
      { u: 'The checkout button does nothing on Safari. Can you fix it?' },
      { b: "Found it. The checkout script reads a date like `2026-11-13 10:00`, which Safari can't parse, so it stopped before the button was switched on.\n\n```js\nconst expires = new Date(cart.expires_at.replace(' ', 'T'))\n```\n\nAll 148 tests pass, plus a new one for this." },
      { u: 'Merge it' },
      { b: 'Merged and live. I clicked through checkout on Safari, Chrome and Firefox, it works on all three.' },
    ],
    chips: [
      { u: 'Why is the site slow?', steps: ['Running a few commands', 'Digging around'], tool: ['Bash', { command: 'npx lighthouse https://shop.example --preset=perf' }],
        reply: [{ b: 'The home page takes 4.1 s to load on a phone. The main reason is the hero photo, a 3.8 MB image.\n\nI converted it to a 240 KB one that looks the same and lazy load the rest. Load time is now 1.6 s. Want me to open the pull request?' }] },
      { u: 'Add a dark mode switch', steps: ['Writing some code', 'Running a few commands'], tool: ['Edit', { file_path: 'settings.js' }],
        reply: [{ b: "Added a dark mode switch to the settings menu. It follows the phone's setting until someone flips it, then remembers their choice.\n\n```js\ntheme.onclick = () => toggleTheme()\n```\n\nAll 151 tests pass. Pull request: **Add dark mode**." }] },
    ],
  },
  {
    key: 'leo', name: 'Leo', color: 'yellow', body: 'cheep', model: 'grok',
    routines: [{ name: 'Flight price watch', time: '12:00', weekdays: [0, 1, 2, 3, 4, 5, 6], enabled: true }],
    history: [
      { u: 'Flights to Lisbon, Dec 12 to 16. Window seat, no red-eyes.' },
      { b: "Best three:\n\n| Route | Leaves | Arrives | Price |\n| --- | --- | --- | --- |\n| Direct | 9:40 AM | 9:55 PM | $612 |\n| Via Madrid | 7:15 AM | 8:30 PM | $488 |\n| Via London | 8:20 AM | 10:10 PM | $534 |\n\nThe direct one is worth the extra $124 if you hate layovers. I'm checking prices every 6 hours and will tell you if it drops." },
    ],
    chips: [
      { u: 'Book a table for 2 on Friday', steps: ['Clicking around', 'Checking restaurants'],
        reply: [{ b: "Booked: **Casa Lume**, Friday at 7:30 PM, table for 2 by the window. It's the Italian place you rated 5 stars in March. Confirmation is in your inbox." }] },
      { u: 'Find a hotel near the old town', steps: ['Searching for hotels in Alfama', 'Digging around'], tool: ['WebSearch', { query: 'hotels alfama lisbon' }],
        reply: [{ b: "Three hotels within a 5 minute walk of the old town:\n\n| Hotel | Per night | Rating |\n| --- | --- | --- |\n| Casa do Rio | $142 | 9.1 |\n| Alfama Rooms | $118 | 8.7 |\n| Hotel Miradouro | $176 | 9.4 |\n\nAlfama Rooms is the best value. All three have free cancellation until Dec 9." }] },
    ],
  },
];
