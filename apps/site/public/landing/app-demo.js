// the app window in the hero: a small remake of dusk bot's main window. every bot opens its own chat, the composer takes
// typing and answers from canned replies matched on keywords, the bot panel opens with its tabs, routines and model
// picker. nothing leaves the page: no requests, no real ai.
// runs from a script tag right after the demo markup, so it answers clicks as soon as the demo shows
(function start() {
  if (!document.querySelector('[data-ad] [data-ad-main]') && document.readyState === 'loading') return document.addEventListener('DOMContentLoaded', start, { once: true });
  const root = document.querySelector('[data-ad]');
  const app = root && root.querySelector('[data-ad-app]');
  if (!app || !('ResizeObserver' in window)) return;
  const main = app.querySelector('[data-ad-main]'), panel = app.querySelector('[data-ad-panel]');
  const phone = matchMedia('(max-width: 700px)');
  const SVG = 'http://www.w3.org/2000/svg';

  const ICONS = {
    person: 'M8 8.5c3.85 0 7 2.5 7 4.5a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2c0-2 3.15-4.5 7-4.5M8 10c-1.61 0-3.064.526-4.092 1.234C2.798 12.001 2.5 12.733 2.5 13a.5.5 0 0 0 .5.5h10a.5.5 0 0 0 .5-.5c0-.267-.297-1-1.408-1.766C11.064 10.526 9.609 10 8 10m0-9a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7m0 1.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4',
    share: 'M7.47 1.22a.75.75 0 0 1 1.06 0l2.5 2.5a.75.75 0 1 1-1.06 1.06L8.75 3.56v7.69a.75.75 0 0 1-1.5 0V3.56L6.03 4.78a.75.75 0 0 1-1.06-1.06zM4.25 6.5a.75.75 0 0 1 0 1.5H4a1.5 1.5 0 0 0-1.5 1.5V12A1.5 1.5 0 0 0 4 13.5h8a1.5 1.5 0 0 0 1.5-1.5V9.5A1.5 1.5 0 0 0 12 8h-.25a.75.75 0 0 1 0-1.5H12a3 3 0 0 1 3 3V12a3 3 0 0 1-3 3H4a3 3 0 0 1-3-3V9.5a3 3 0 0 1 3-3z',
    more: 'M3 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3M9.5 8a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0m5 0a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0',
    up: 'M8 14.75a.75.75 0 0 1-.75-.75V3.81L4.53 6.53a.75.75 0 0 1-1.06-1.06l4-4a.75.75 0 0 1 1.06 0l4 4a.75.75 0 0 1-1.06 1.06L8.75 3.81V14a.75.75 0 0 1-.75.75',
    search: 'M11.5 7a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0m-.82 4.74a6 6 0 1 1 1.06-1.06l2.79 2.79a.75.75 0 1 1-1.06 1.06z',
    plus: 'M8 1.75a.75.75 0 0 1 .75.75v4.75h4.75a.75.75 0 0 1 0 1.5H8.75v4.75a.75.75 0 0 1-1.5 0V8.75H2.5a.75.75 0 0 1 0-1.5h4.75V2.5A.75.75 0 0 1 8 1.75',
    x: 'M3.47 3.47a.75.75 0 0 1 1.06 0L8 6.94l3.47-3.47a.75.75 0 1 1 1.06 1.06L9.06 8l3.47 3.47a.75.75 0 1 1-1.06 1.06L8 9.06l-3.47 3.47a.75.75 0 0 1-1.06-1.06L6.94 8 3.47 4.53a.75.75 0 0 1 0-1.06',
    back: 'M14.75 8a.75.75 0 0 1-.75.75H3.81l2.72 2.72a.75.75 0 1 1-1.06 1.06l-4-4a.75.75 0 0 1 0-1.06l4-4a.75.75 0 0 1 1.06 1.06L3.81 7.25H14a.75.75 0 0 1 .75.75',
    down: 'M2.97 5.47a.75.75 0 0 1 1.06 0L8 9.44l3.97-3.97a.75.75 0 1 1 1.06 1.06l-4.5 4.5a.75.75 0 0 1-1.06 0l-4.5-4.5a.75.75 0 0 1 0-1.06',
    check: 'M13.488 3.43a.75.75 0 0 1 .081 1.058l-6 7a.75.75 0 0 1-1.1.042l-3.5-3.5A.75.75 0 0 1 4.03 6.97l2.928 2.927 5.473-6.385a.75.75 0 0 1 1.057-.081',
    download: 'M8.53 11.78a.75.75 0 0 1-1.06 0l-2.5-2.5a.75.75 0 0 1 1.06-1.06l1.22 1.22V1.75a.75.75 0 0 1 1.5 0v7.69l1.22-1.22a.75.75 0 1 1 1.06 1.06zM1.75 13.5a.75.75 0 0 0 0 1.5h12.5a.75.75 0 0 0 0-1.5z',
  };

  const MODELS = [
    ['sonnet', 'Claude Sonnet 5', 'claude', 'Claude'], ['opus', 'Claude Opus 5.5', 'claude', 'Claude'],
    ['gpt', 'GPT-5.5', 'chatgpt', 'ChatGPT'], ['gemini', 'Gemini 3.8 Flash', 'gemini', 'Gemini'], ['grok', 'Grok 4.7', 'grok', 'Grok'],
  ];

  // the conversation pieces: ['u', text] you, ['b', text] the bot ("- " lines are a list, **x** is bold, `x` is code),
  // ['t', head, rows] a table, ['f', name, kind, colour] a file, ['c', lines] a code change, ['s', text] a step it took,
  // ['e', text] an event line, ['q', text] a draft, ['dl'] the download card
  const BOTS = {
    dusk: {
      hue: '#1c1c1c', role: 'Your main bot', model: 'sonnet', memory: 24, skills: 5,
      where: 'Private desktop', now: 'Checking tomorrow\'s calendar',
      screen: { url: 'calendar', title: 'Thursday, Nov 13', rows: [['9:00', 'Inbox replies'], ['9:30', 'Pitch deck, focus time'], ['12:00', 'Lunch'], ['2:00', 'Priya, moved from 11:30', 1], ['4:00', 'Review checkout fix']] },
      routines: [
        { name: 'Morning brief', when: 'Every weekday at 8 AM', on: true, last: 'Today, 8:00 AM', what: 'Check what every bot did overnight, read the calendar and the inbox, and send one short summary with what needs me first.' },
        { name: 'Friday wrap-up', when: 'Every Friday at 5 PM', on: false, last: 'Last Friday, 5:00 PM', what: 'List what got done this week, what slipped, and three things to start Monday with.' },
      ],
      library: [['morning-brief.md', 'Today'], ['week-plan.md', 'Monday']],
      history: [
        ['e', 'Morning brief ran at 8:00 AM'],
        ['b', 'Good morning. Here\'s what the team did overnight:'],
        ['t', ['Bot', 'Did', 'Needs you'], [['Inbox', 'Sorted 63 emails, drafted 4 replies', '2 to approve'], ['Researcher', 'Compared 3 CRMs', 'No'], ['Bookkeeper', 'Closed October', '3 subscriptions'], ['Coder', 'Fixed checkout on Safari', 'No']]],
        ['b', 'Priya moved your 11:30 to 2:00. I updated your calendar and told her that works.'],
        ['u', 'Nice. What should I do first?'],
        ['b', 'Approve the two replies in Inbox, the landlord one is due Friday. Then the subscriptions with Bookkeeper. Everything else can wait until after lunch.'],
      ],
      chips: ['What can you do?', 'Plan my day', 'Remind me to call mom at 6'],
      intents: [
        [/what can|what do you|help me|can you do|how does|how do you/i, 'Thinking', null, [['b', 'I\'m your main bot. I run on a computer of my own, so I can do what you\'d do at a desk: browse, fill in forms, write, sort email, run code.\n\nI also hand work to the right teammate. Research goes to Researcher, money to Bookkeeper, code to Coder. Then I tell you when it\'s done.']]],
        [/plan|day|today|schedule|calendar|week|tomorrow|morning/i, 'Reading your calendar', 'Read your calendar and inbox', [['b', 'Here\'s a plan that keeps your mornings clear:'], ['t', ['Time', 'What'], [['9:00', 'Approve 2 replies (10 min)'], ['9:30', 'Pitch deck, no meetings'], ['12:00', 'Lunch'], ['2:00', 'Priya'], ['4:00', 'Review the checkout fix']]], ['b', 'Want me to decline the optional 4:30 sync so you get an early finish?']]],
        [/remind|reminder|don't forget|dont forget|call|ping me/i, 'Setting a reminder', null, [['b', 'Done. I\'ll message you at 6 PM: "Call mom." It\'s on your calendar too, so your phone will ping.']]],
        [/decline|cancel|sync|meeting/i, 'Updating your calendar', 'Declined 1 event', [['b', 'Declined the 4:30 with a short note: "Can\'t make this one, I\'ll read the notes." Your day now ends at 4:30.']]],
        [/report|who|which bot|ask|team/i, 'Thinking', null, [['b', 'For numbers, ask Bookkeeper. For a market scan, Researcher. Anything written goes to Content Writer.\n\nOr just tell me what you need. I\'ll pass it to the right bot and report back here.']]],
        [/trip|flight|travel|hotel|book/i, 'Passing this to Leo', null, [['b', 'That\'s Leo\'s job, he handles trips and errands. I\'ve passed it over and he\'ll answer in his chat with options.']]],
      ],
    },
    researcher: {
      hue: '#7442d1', role: 'Finds things out', model: 'gpt', memory: 9, skills: 3,
      where: 'Private desktop', now: 'Reading pricing pages',
      screen: { url: 'hatch / pricing', title: 'Pricing', rows: [['Starter', '$12 / seat'], ['Team', '$20 / seat', 1], ['Business', '$34 / seat'], ['Gmail plugin', 'All plans'], ['Free trial', '14 days']] },
      routines: [{ name: 'Competitor watch', when: 'Every Monday at 9 AM', on: true, last: 'Monday, 9:00 AM', what: 'Check the pricing pages of our four competitors and tell me if anything changed, with a link and the old price.' }],
      library: [['crm-shortlist.csv', 'Today'], ['review-themes.md', 'Yesterday']],
      history: [
        ['u', 'Find me a CRM for a team of 5. Under $30 a seat, and it has to work with Gmail.'],
        ['s', 'Read 23 pages, 4 pricing tables and 112 reviews'],
        ['b', 'Three fit. Here\'s how they compare:'],
        ['t', ['Tool', 'Per seat', 'Gmail', 'Reviews'], [['Hatch', '$20', 'Yes', '4.7 (180)'], ['Plainsight', '$24', 'Yes', '4.5 (2,310)'], ['Roster', '$29', 'Yes', '4.6 (240)']]],
        ['b', 'I\'d pick **Hatch**. Cheapest, simplest, and reviewers keep saying setup took an afternoon. Plainsight is stronger if you\'ll run a real sales pipeline later.'],
        ['f', 'crm-shortlist.csv', 'CSV', '#10ab61'],
      ],
      chips: ['Compare 3 laptops under $1,000', 'What do customers say about us?', 'Find a venue for 40 people'],
      intents: [
        [/laptop|computer|phone|headphone|compare|best|buy|which .* should/i, 'Comparing laptops', 'Read 31 reviews and 3 spec sheets', [['b', 'For everyday work, these three are the best value right now:'], ['t', ['Laptop', 'Price', 'Battery', 'Weight'], [['Lumen 14', '$899', '15 h', '1.3 kg'], ['Corvo Air', '$949', '18 h', '1.2 kg'], ['Nimbus 13', '$799', '11 h', '1.4 kg']]], ['b', 'Corvo Air if battery matters most. Nimbus 13 if you want to save $150 and mostly work at a desk.']]],
        [/customer|review|say about|feedback|complain/i, 'Reading reviews', 'Read 212 reviews on 3 sites', [['b', 'I read 212 reviews from the last 90 days. The short version:\n- **Loved:** fast shipping (48 mentions) and packaging (31)\n- **Disliked:** app login keeps logging people out (27)\n- **Asked for:** gift cards (12)\n\nFixing login would cover most of the 1 and 2 star reviews.'], ['f', 'review-themes.md', 'Markdown', '#5f5f5f']]],
        [/venue|event|party|room|space|offsite|restaurant/i, 'Searching venues', 'Checked 14 venues', [['b', 'Four venues have space for 40 on a Friday evening:'], ['t', ['Venue', 'Fits', 'Price', 'From you'], [['The Loft on 5th', '60', '$1,200', '8 min'], ['Greenhouse Hall', '45', '$950', '15 min'], ['Harbor Room', '50', '$1,400', '20 min']]], ['b', 'Greenhouse Hall is the best value and has its own catering. Want me to ask about December dates?']]],
        [/competitor|pricing|price|market|trend|news/i, 'Checking competitors', 'Checked 4 pricing pages', [['b', 'One change since Monday: Roster raised its Pro plan from $19 to $24 a seat. Everyone else is the same. You\'re now the cheapest of the four.']]],
      ],
    },
    writer: {
      hue: '#c82779', role: 'Writes and edits', model: 'opus', memory: 14, skills: 4,
      where: 'Private desktop', now: 'Drafting the newsletter',
      screen: { url: 'docs / newsletter', title: 'Thursday newsletter', rows: ['Hi friends,', 'Same-day delivery is live. Order by 2 PM', 'and it arrives tonight, free over $40.', '', 'Also new this week: gift wrap, and a', 'fix for the login bug a few of you hit.'] },
      routines: [{ name: 'Newsletter draft', when: 'Every Thursday at 10 AM', on: true, last: 'Last Thursday, 10:00 AM', what: 'Read what we shipped this week and draft the newsletter in our usual voice. Don\'t send it, leave it for me.' }],
      library: [['delivery-post.md', 'Today'], ['newsletter-nov-6.md', 'Last week']],
      history: [
        ['u', 'Write a LinkedIn post about our new same-day delivery. Short, no hype.'],
        ['b', 'Here\'s a draft:'],
        ['q', 'Starting Monday, orders placed before 2 PM arrive the same day, anywhere in the city.\n\nWe tested it for six weeks with 300 customers. 94% of orders landed before 7 PM.\n\nIt\'s free over $40. Under that, it\'s $4.\n\nThank you to the drivers who made the test work.'],
        ['u', 'Love it. Instagram version too?'],
        ['b', 'Two lines, leading with the cutoff:'],
        ['q', 'Order by 2 PM, get it tonight. Same-day delivery is live across the city, free over $40.'],
      ],
      chips: ['Write a welcome email', 'Give me 5 blog ideas', 'Make "Your payment failed" friendlier'],
      intents: [
        [/welcome|email|onboard|newsletter/i, 'Writing', null, [['b', 'Here\'s a welcome email:'], ['q', 'Subject: You\'re in\n\nHi Sam,\n\nThanks for your first order. It ships today, and you\'ll get a tracking link the moment it leaves.\n\nIf anything\'s off, just reply to this email. A real person reads every one.\n\nTalk soon,\nThe team']]],
        [/idea|blog|topic|article|content/i, 'Brainstorming', null, [['b', 'Five ideas, picked from what your customers ask about most:\n- How we pack a mug so it never breaks\n- Same-day delivery: what happens after you click buy\n- 3 ways to style one ceramic set\n- Why we stopped using plastic tape\n- A day with one of our drivers\n\nThe packing one should do best, it\'s the top question in your reviews.']]],
        [/friendl|rewrite|tone|softer|shorter|edit|sound/i, 'Rewriting', null, [['b', 'A friendlier version:'], ['q', 'Your payment didn\'t go through. No worries, it happens. Try another card, or try again in a minute.'], ['b', 'It says what happened, doesn\'t blame anyone, and gives a next step.']]],
        [/post|tweet|caption|linkedin|instagram|social|ad\b/i, 'Writing', null, [['b', 'Here\'s one for X:'], ['q', 'We tested same-day delivery for six weeks. 94% of orders arrived before 7 PM. Starting Monday, it\'s for everyone.']]],
      ],
    },
    inbox: {
      hue: '#126fd4', role: 'Keeps email under control', model: 'gemini', memory: 31, skills: 2, unread: true,
      where: 'Private desktop', now: 'Filing receipts',
      screen: { url: 'mail', title: 'Inbox', rows: [['Priya S.', 'Can we move to 2?'], ['Daniel (landlord)', 'Lease renewal', 1], ['Sam', 'Final logo files'], ['Bank', 'Your new card shipped'], ['Weekly digest', '12 new posts']] },
      routines: [
        { name: 'Morning sort', when: 'Every day at 7 AM', on: true, last: 'Today, 7:00 AM', what: 'File newsletters and receipts, flag anything that needs a reply today, and draft the easy replies for me to approve.' },
        { name: 'Unsubscribe sweep', when: 'First of every month', on: false, last: 'Nov 1', what: 'Unsubscribe me from anything I haven\'t opened in 60 days. Show me the list first.' },
      ],
      library: [['landlord-reply.txt', 'Today']],
      history: [
        ['e', 'Morning sort ran at 7:00 AM'],
        ['b', '63 new emails. 51 were newsletters and receipts, so I filed them. These need you:'],
        ['t', ['From', 'About', 'Status'], [['Priya S.', 'Moving 11:30 to 2:00', 'Accepted'], ['Daniel (landlord)', 'Lease renewal, due Friday', 'Draft ready'], ['Sam', 'Final logo files', 'Saved to Drive']]],
        ['b', 'I drafted a reply to Daniel asking to keep the rent the same for 12 months. Send it?'],
        ['u', 'Send it'],
        ['b', 'Sent. I\'ll tell you when he answers.'],
      ],
      chips: ['What did I miss today?', 'Unsubscribe me from the junk', 'Reply to Sam: looks great, thanks'],
      intents: [
        [/miss|today|new|summary|summar|anything|important/i, 'Reading new mail', 'Read 9 new emails', [['b', 'Since this morning, 9 new emails. Only two matter:\n- **Daniel** agreed to keep the rent the same. He\'ll send the lease Monday.\n- **Sam** asked if Thursday works for the launch call.\n\nThe rest were receipts and newsletters, all filed.']]],
        [/unsub|junk|spam|newsletter|clean/i, 'Checking subscriptions', 'Unsubscribed from 14 lists', [['b', 'Done. I unsubscribed you from 14 lists you haven\'t opened in 60 days, like the shoe store and the three webinar ones. I kept your bank, school and anything with a receipt.']]],
        [/reply|answer|respond|send|write back|tell/i, 'Writing a reply', 'Sent 1 email', [['b', 'Sent to Sam:'], ['q', 'Looks great, thanks Sam. Let\'s go with these.'], ['b', 'I kept it short, like your other replies to him.']]],
        [/find|search|where|invoice|attachment|pdf/i, 'Searching mail', 'Searched 4,210 emails', [['b', 'Found it: "Invoice #2291" from Sam, sent Oct 3, with the PDF attached. I saved a copy to your Drive in Invoices.']]],
      ],
    },
    maya: {
      hue: '#0d9655', role: 'Home, meals and the family calendar', model: 'sonnet', memory: 18, skills: 3,
      where: 'Private desktop', now: 'Filling the grocery cart',
      screen: { url: 'grocer / cart', title: 'Your cart, 23 items', rows: [['Chickpeas x2', '$2.40'], ['Halloumi', '$5.90', 1], ['Tortillas', '$3.20'], ['Lemons x4', '$2.00'], ['Pizza flour', '$4.50']] },
      routines: [{ name: 'Sunday meal plan', when: 'Every Sunday at 5 PM', on: true, last: 'Sunday, 5:00 PM', what: 'Plan five dinners for the week for 4 people, one vegetarian, nothing over 40 minutes. Put the shopping in the cart, don\'t order.' }],
      library: [['meal-plan.pdf', 'Sunday'], ['shopping-list.txt', 'Sunday']],
      history: [
        ['u', 'Plan dinners for this week. 4 people, Ana is vegetarian, nothing over 40 minutes.'],
        ['b', 'Here\'s the week:'],
        ['t', ['Day', 'Dinner', 'Time'], [['Mon', 'Lemon chickpea pasta', '25 min'], ['Tue', 'Tacos, bean ones for Ana', '30 min'], ['Wed', 'Halloumi tray bake', '35 min'], ['Thu', 'Leftovers night', '0 min'], ['Fri', 'Homemade pizza', '40 min']]],
        ['b', 'I put everything in your grocery cart: 23 items, about $86. It\'s not ordered yet. Say the word.'],
        ['f', 'meal-plan.pdf', 'PDF', '#e72e3b'],
      ],
      chips: ['Order the groceries', 'Find a dentist open on Saturday', 'What\'s on this weekend?'],
      intents: [
        [/order|grocer|cart|buy|shop/i, 'Placing the order', 'Ordered 23 items', [['b', 'Ordered. Delivery is Tuesday between 6 and 7 PM, total $84.60. The store was out of halloumi, so I swapped in paneer. It works the same in the tray bake.']]],
        [/dentist|doctor|appointment|clinic|vet|haircut/i, 'Looking for open slots', 'Checked 6 clinics', [['b', 'Two near you have Saturday slots:'], ['t', ['Clinic', 'Slot', 'Distance'], [['Harbor Dental', '10:15 AM', '1.2 km'], ['Elm Street Dental', '1:30 PM', '2.5 km']]], ['b', 'Harbor Dental takes your insurance. Want me to book 10:15?']]],
        [/weekend|saturday|sunday|kids|fun|do this/i, 'Checking what\'s on', null, [['b', 'This weekend:\n- **Saturday 10 AM:** farmers market by the river, free\n- **Saturday 3 PM:** Leo\'s friend\'s birthday, gift is already bought\n- **Sunday:** clear. The weather says 19 and sunny, good for the park.']]],
        [/recipe|cook|dinner|lunch|meal|vegetarian/i, 'Finding a recipe', null, [['b', 'Tonight is lemon chickpea pasta. 25 minutes: boil the pasta, fry garlic and chickpeas, add lemon, spinach and parmesan. I sent the recipe to the kitchen tablet.']]],
      ],
    },
    books: {
      hue: '#d2550a', role: 'Money, receipts and invoices', model: 'gpt', memory: 21, skills: 4, unread: true, wait: true,
      where: 'Private desktop', now: 'Matching receipts',
      screen: { url: 'sheets / october close', title: 'October', rows: [['Revenue', '$18,420'], ['Costs', '$11,230'], ['Profit', '$7,190', 1], ['Receipts matched', '41 of 43'], ['Unused software', '$89 / mo']] },
      routines: [
        { name: 'Monthly close', when: 'First of every month at 9 AM', on: true, last: 'Nov 1, 9:00 AM', what: 'Match every transaction to a receipt, close the month in the spreadsheet, and send me a one table summary.' },
        { name: 'Receipt check', when: 'Every Friday at 4 PM', on: true, last: 'Last Friday, 4:00 PM', what: 'Find receipts missing for this week\'s card payments and ask me for them in one message.' },
      ],
      library: [['october-close.xlsx', 'Nov 1'], ['invoice-1042.pdf', 'Last week']],
      history: [
        ['u', 'How did October go?'],
        ['s', 'Read 214 transactions from your bank export'],
        ['b', 'Good month:'],
        ['t', ['', 'October', 'September'], [['Revenue', '$18,420', '$15,910'], ['Costs', '$11,230', '$10,870'], ['Profit', '$7,190', '$5,040']]],
        ['f', 'october-close.xlsx', 'Spreadsheet', '#10ab61'],
        ['b', 'Profit is up 43%, mostly from the new wholesale orders. Three subscriptions you haven\'t opened in 60 days cost $89 a month together. Cancel them?'],
      ],
      chips: ['Yes, cancel them', 'Send invoice 1043 to Rivera Studio', 'How much tax should I set aside?'],
      intents: [
        [/yes|cancel|subscri|unused|stop paying/i, 'Cancelling subscriptions', 'Cancelled 3 subscriptions', [['b', 'Cancelled all three. That\'s $89 a month, or $1,068 a year. I saved the confirmation emails in Receipts in case you need them back.']]],
        [/invoice|bill|charge|send|pay/i, 'Making the invoice', 'Sent 1 invoice', [['b', 'Sent invoice 1043 to Rivera Studio: $2,400 for the November wholesale order, due in 30 days. I\'ll remind them nicely if it isn\'t paid by Dec 13.'], ['f', 'invoice-1043.pdf', 'PDF', '#e72e3b']]],
        [/tax|vat|irs|set aside|save/i, 'Working it out', null, [['b', 'Based on this year\'s profit so far, set aside about **$2,150** from October. I used the same 30% you saved last quarter. Want me to move it to your tax savings account on the 1st each month?']]],
        [/expense|receipt|spend|spent|cost|budget/i, 'Reading transactions', null, [['b', 'Biggest costs in October:\n- Packaging: $3,120\n- Shipping: $2,880\n- Software: $640\n\nShipping is up 18% since summer. Researcher could look for a cheaper courier.']]],
      ],
    },
    coder: {
      hue: '#0d9381', role: 'Builds and fixes the website', model: 'opus', memory: 40, skills: 6,
      where: 'Private desktop', now: 'Running the tests',
      screen: { mono: 1, url: 'checkout.js', title: '', rows: ['function startCheckout(cart) {', '  const expires = new Date(', '    cart.expires_at.replace(\' \', \'T\')', '  )', '  if (expires < Date.now()) return renew(cart)', '  button.disabled = false', '}'] },
      routines: [{ name: 'Nightly tests', when: 'Every day at 2 AM', on: true, last: 'Today, 2:00 AM', what: 'Run every test against the live site. If anything fails, find out why and open a fix, but don\'t merge it.' }],
      library: [['fix-safari-checkout.diff', 'Today'], ['test-report.html', 'Today']],
      history: [
        ['u', 'The checkout button does nothing on Safari. Can you fix it?'],
        ['s', 'Opened the site in Safari, read 6 files, ran 148 tests'],
        ['b', 'Found it. The checkout script reads a date like `2026-11-13 10:00`, which Safari can\'t parse, so it stopped before the button was switched on.'],
        ['c', ['- const expires = new Date(cart.expires_at)', '+ const expires = new Date(cart.expires_at.replace(\' \', \'T\'))']],
        ['b', 'All 148 tests pass, plus a new one for this. The pull request is ready: **Fix checkout on Safari**.'],
        ['u', 'Merge it'],
        ['b', 'Merged and live. I clicked through checkout on Safari, Chrome and Firefox, it works on all three.'],
      ],
      chips: ['Why is the site slow?', 'Add a dark mode switch', 'Write tests for the signup form'],
      intents: [
        [/slow|speed|fast|perform|load/i, 'Measuring the site', 'Ran 3 speed tests', [['b', 'The home page takes 4.1 s to load on a phone. The main reason is the hero photo, a 3.8 MB image.\n\nI converted it to a 240 KB one that looks the same and lazy load the rest. Load time is now 1.6 s. Want me to open the pull request?']]],
        [/dark|feature|add|build|make|button|page/i, 'Writing code', 'Changed 4 files, ran 151 tests', [['b', 'Added a dark mode switch to the settings menu. It follows the phone\'s setting until someone flips it, then remembers their choice.'], ['c', ['+ <button aria-pressed="false" id="theme">Dark mode</button>', '+ theme.onclick = () => toggleTheme()']], ['b', 'All tests pass. Pull request: **Add dark mode**.']]],
        [/test/i, 'Writing tests', 'Wrote 9 tests', [['b', 'Wrote 9 tests for the signup form: empty fields, a bad email, a short password, a taken email, and the happy path on phone and desktop. One failed: a password with a space was rejected. Fixed that too.']]],
        [/bug|error|fix|broken|crash|wrong|issue|not work/i, 'Looking into it', 'Read the error logs', [['b', 'The only new error in the logs today: the newsletter signup returns an error when the email has a capital letter. I lowercased it before saving and added a test. Fixed and live.']]],
      ],
    },
    leo: {
      hue: '#c2730b', role: 'Trips and errands', model: 'grok', memory: 11, skills: 3,
      where: 'Private desktop', now: 'Watching flight prices',
      screen: { url: 'flights / lisbon', title: 'Dec 12 to 16, 1 adult', rows: [['Direct, 9:40 AM', '$612'], ['Via Madrid, 7:15 AM', '$488', 1], ['Via London, 8:20 AM', '$534'], ['Window seat', 'Available'], ['Price trend', 'Steady']] },
      routines: [{ name: 'Flight price watch', when: 'Every 6 hours', on: true, last: 'Today, 12:00 PM', what: 'Check the Lisbon flights for Dec 12 to 16 and tell me if the direct one drops under $560.' }],
      library: [['lisbon-options.md', 'Yesterday']],
      history: [
        ['u', 'Flights to Lisbon, Dec 12 to 16. Window seat, no red-eyes.'],
        ['s', 'Checked 5 airline and booking sites'],
        ['b', 'Best three:'],
        ['t', ['Route', 'Leaves', 'Arrives', 'Price'], [['Direct', '9:40 AM', '9:55 PM', '$612'], ['Via Madrid', '7:15 AM', '8:30 PM', '$488'], ['Via London', '8:20 AM', '10:10 PM', '$534']]],
        ['b', 'The direct one is worth the extra $124 if you hate layovers. I\'m checking prices every 6 hours and will tell you if it drops.'],
      ],
      chips: ['Book a table for 2 on Friday', 'Find a hotel near the old town', 'What do I need to renew my passport?'],
      intents: [
        [/table|restaurant|dinner|reserv|eat/i, 'Checking restaurants', 'Checked 8 restaurants', [['b', 'Booked: **Casa Lume**, Friday at 7:30 PM, table for 2 by the window. It\'s the Italian place you rated 5 stars in March. Confirmation is in your inbox.']]],
        [/hotel|stay|room|airbnb|apartment/i, 'Searching hotels', 'Compared 26 hotels', [['b', 'Three hotels within a 5 minute walk of the old town:'], ['t', ['Hotel', 'Per night', 'Rating'], [['Casa do Rio', '$142', '9.1'], ['Alfama Rooms', '$118', '8.7'], ['Hotel Miradouro', '$176', '9.4']]], ['b', 'Alfama Rooms is the best value. All three have free cancellation until Dec 9.']]],
        [/passport|visa|renew|document|form/i, 'Reading the passport office site', null, [['b', 'For a renewal you need:\n- Your current passport\n- One new photo, 35 by 45 mm\n- The renewal form, I filled in everything I could\n- The $130 fee\n\nIt takes about 4 weeks, so apply by Nov 14 to be safe for Lisbon.']]],
        [/flight|fly|ticket|cheaper|price|drop/i, 'Checking prices', 'Checked 5 sites', [['b', 'No drop yet. The direct flight is still $612. Prices for these dates have been steady all week, so I\'d book by Sunday.']]],
      ],
    },
  };
  const ORDER = Object.keys(BOTS);

  // what every bot answers the same way
  const SHARED = [
    [/^\s*(hi|hey|hello|yo|hiya|good (morning|afternoon|evening))\b/i, null, null, (b) => [['b', `Hi! I\'m ${b.name}. Tap one of the suggestions below, or ask me something.`]]],
    [/thank|thanks|great|perfect|awesome|nice|cool|love it/i, null, null, () => [['b', 'Anytime. I\'ll be here when you need the next thing.']]],
    [/who are you|what are you|are you (an? )?(ai|bot|real|human)/i, null, null, (b) => [['b', `I\'m ${b.name}, one of your bots in dusk bot. I run on your own AI subscription and do the work on a computer of my own.`]]],
    [/price|cost|free|pay for|how much|subscription/i, null, null, () => [['b', 'It\'s free on your computer. dusk bot runs on the Claude, ChatGPT, Gemini or Grok you already pay for. The paid add-on, dusk cloud, keeps your bots working when your laptop is closed.']]],
    [/safe|privacy|private|data|secure|trust/i, null, null, () => [['b', 'Everything runs on your machine or your own cloud desktop. Your chats and files stay yours, and I ask before anything risky, like sending money or deleting things.']]],
  ];

  const INSTALL = [
    (b) => `That one I need to really do, on my own computer. Install dusk bot, ask me again, and I\'ll get on it.`,
    (b) => `I\'m enjoying this, but in this demo my answers are canned. Install dusk bot and ${b.name} will do this for real.`,
    (b) => `This is where the demo ends for me. Once dusk bot is installed I can actually do it, and remember how you like it.`,
  ];

  const state = {};
  for (const id of ORDER) {
    const b = BOTS[id];
    b.id = id;
    b.name = app.querySelector(`[data-bot="${id}"] b`).textContent;
    state[id] = { msgs: b.history.slice(), chips: b.chips.slice(), model: b.model, on: b.routines.map((r) => r.on), used: new Set(), typed: 0, busy: null, unread: !!b.unread, wait: !!b.wait };
  }
  let draft = '', current = 'dusk', tab = 'details', page = null, installs = 0, panelOpen = !phone.matches, menu = null;

  // building blocks
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    if (props) for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid);
    return el;
  }
  function icon(name) {
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', '-0.5 -0.5 17 17');
    svg.setAttribute('class', 'ad-ic');
    svg.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS(SVG, 'path');
    p.setAttribute('fill', 'currentColor');
    p.setAttribute('fill-rule', 'evenodd');
    p.setAttribute('d', ICONS[name]);
    svg.append(p);
    return svg;
  }
  const row = (bot) => app.querySelector(`.ad-bot[data-bot="${bot}"]`);
  const face = (bot) => { const svg = row(bot).querySelector('svg.bot').cloneNode(true); svg.removeAttribute('data-px'); return svg; };
  const model = (id) => MODELS.find((m) => m[0] === id);
  const logo = (m) => h('img', { src: `/art/logos/${m[2]}.svg`, alt: '', width: 16, height: 16 });

  // **bold** and `code` inside a line
  function inline(text) {
    const out = [];
    for (const part of text.split(/(\*\*[^*]+\*\*|`[^`]+`)/)) {
      if (!part) continue;
      if (part.startsWith('**')) out.push(h('b', { text: part.slice(2, -2) }));
      else if (part.startsWith('`')) out.push(h('code', { text: part.slice(1, -1) }));
      else out.push(part);
    }
    return out;
  }
  function prose(text) {
    const out = [];
    for (const para of text.split('\n\n')) {
      const lines = para.split('\n');
      if (lines.every((l) => l.startsWith('- '))) out.push(h('ul', null, lines.map((l) => h('li', null, inline(l.slice(2))))));
      else out.push(h('p', null, inline(para)));
    }
    return out;
  }

  function piece(m, bot) {
    const [kind, a, b, c] = m;
    if (kind === 'u') return h('div', { class: 'ad-msg ad-me' }, a);
    if (kind === 'b') return h('div', { class: 'ad-msg ad-bubble' }, prose(a));
    if (kind === 'q') return h('div', { class: 'ad-msg ad-bubble' }, h('div', { class: 'ad-quote' }, prose(a)));
    if (kind === 'e') return h('div', { class: 'ad-ev', text: a });
    if (kind === 's') return h('div', { class: 'ad-step' }, icon('check'), a);
    if (kind === 'c') return h('div', { class: 'ad-msg ad-bubble' }, h('div', { class: 'ad-code' }, a.map((l) => h('div', { class: l[0] === '-' ? 'del' : 'add', text: l }))));
    if (kind === 't') {
      return h('div', { class: 'ad-card' }, h('table', { class: 'ad-table' },
        h('thead', null, h('tr', null, a.map((x) => h('th', { text: x })))),
        h('tbody', null, b.map((r) => h('tr', null, r.map((x) => h('td', { text: x })))))));
    }
    if (kind === 'f') {
      const ic = h('span', { class: 'ad-file-ic' });
      ic.style.setProperty('--k', c);
      return h('div', { class: 'ad-card ad-file' }, ic, h('div', null, h('b', { text: a }), h('span', { text: b })));
    }
    if (kind === 'dl') {
      return h('div', { class: 'ad-card ad-get' },
        h('a', { class: 'ad-dl', href: '/download', 'data-dusk-goal': 'demo_download' }, icon('download'), 'Download dusk bot'),
        h('p', { text: 'Free on your computer. macOS, Windows and Linux, plus the phone app.' }));
    }
    return null;
  }

  function preview(id) {
    const s = state[id];
    if (s.busy) return s.busy + '…';
    for (let i = s.msgs.length - 1; i >= 0; i--) {
      const [kind, a] = s.msgs[i];
      if (kind === 'b' || kind === 'q') return (s.wait ? 'Waiting for you: ' : '') + a.replace(/\*\*|`/g, '').replace(/\n+/g, ' ');
      if (kind === 'u') return 'You: ' + a;
      if (kind === 'f') return a;
      if (kind === 'dl') return 'Download dusk bot';
    }
    return '';
  }
  function paintRow(id) {
    const r = row(id), s = state[id], p = r.querySelector('[data-preview]');
    p.textContent = preview(id);
    p.classList.toggle('wait', s.wait);
    r.querySelector('.ad-dot').classList.toggle('wait', s.wait);
    r.classList.toggle('unread', s.unread && id !== current);
    r.setAttribute('aria-current', String(id === current && (!phone.matches || app.dataset.view === 'chat')));
    r.setAttribute('aria-label', `${BOTS[id].name}${s.unread && id !== current ? ', unread' : ''}`);
  }
  const mascot = (id, mood) => { try { window.duskBots && window.duskBots.state(row(id).querySelector('svg.bot'), mood); } catch {} };

  // the chat
  let thread, col, input, send, chipsEl;
  function renderChat() {
    const b = BOTS[current], s = state[current];
    app.style.setProperty('--hue', b.hue);
    const pill = h('button', { class: 'ad-pill', type: 'button', 'aria-label': `${b.name}, open details`, 'aria-expanded': String(panelOpen), onclick: () => togglePanel() }, face(current), b.name);
    const more = h('button', { class: 'ad-round', type: 'button', 'aria-label': `More about ${b.name}`, 'aria-expanded': String(panelOpen), onclick: () => togglePanel() }, icon('more'));
    const back = h('button', { class: 'ad-round ad-back', type: 'button', 'aria-label': 'Back to bots', onclick: () => showList() }, icon('back'));
    col = h('div', { class: 'ad-col', role: 'log', 'aria-live': 'polite', 'aria-label': `Chat with ${b.name}` }, s.msgs.map((m) => piece(m, b)));
    if (s.busy) col.append(work(s.busy));
    thread = h('div', { class: 'ad-thread' }, col);
    input = h('input', { type: 'text', placeholder: `Message ${b.name}`, 'aria-label': `Message ${b.name}`, autocomplete: 'off', enterkeyhint: 'send', maxlength: 400 });
    send = h('button', { class: 'ad-send', type: 'submit', 'aria-label': 'Send', disabled: true, 'data-dusk-goal': 'demo_play' }, icon('up'));
    input.value = draft;
    send.disabled = !draft.trim();
    input.addEventListener('input', () => { draft = input.value; send.disabled = !input.value.trim(); });
    const form = h('form', { class: 'ad-compose', onsubmit: (e) => { e.preventDefault(); ask(input.value); } },
      h('button', { class: 'ad-plus', type: 'button', 'aria-label': 'Add files' }, icon('plus')), input, send);
    chipsEl = h('div', { class: 'ad-chips', role: 'group', 'aria-label': 'Suggestions' });
    paintChips();
    main.replaceChildren(h('div', { class: 'ad-head' }, back, pill, panelOpen && !phone.matches ? null : more), thread, h('div', { class: 'ad-foot' }, h('div', { class: 'ad-foot-in' }, chipsEl, form)));
    toBottom();
  }
  function paintChips() {
    const s = state[current];
    chipsEl.replaceChildren(...(s.busy ? [] : s.chips.map((c) => h('button', { class: 'ad-chip', type: 'button', text: c, onclick: () => ask(c, true) }))));
    chipsEl.hidden = !chipsEl.childElementCount;
  }
  const toBottom = () => { if (thread) thread.scrollTop = thread.scrollHeight; };
  const work = (text) => h('div', { class: 'ad-work ad-in', 'data-work': '' }, h('i', { 'aria-hidden': 'true' }, h('b'), h('b'), h('b')), text + '…');

  // a suggested prompt always gets its answer; free typing gets a few matched answers per bot, then the install nudge
  function reply(id, text, chip) {
    const b = BOTS[id], s = state[id];
    const words = text.trim();
    let hit = null;
    if (chip || s.typed <= 3) {
      for (const it of b.intents) if (it[0].test(words) && (chip || !s.used.has(it))) { hit = it; break; }
      if (!hit) for (const it of SHARED) if (it[0].test(words) && !s.used.has(it)) { hit = it; break; }
      if (hit && !chip && words.length > 160) hit = null;
    }
    if (!hit) {
      const line = INSTALL[installs++ % INSTALL.length](b);
      return { step: 'Thinking', done: null, out: [['b', line], ['dl']] };
    }
    s.used.add(hit);
    return { step: hit[1] || 'Thinking', done: hit[2], out: typeof hit[3] === 'function' ? hit[3](b) : hit[3] };
  }

  function push(id, m) {
    state[id].msgs.push(m);
    if (id === current && col) {
      const el = piece(m, BOTS[id]);
      el.classList.add('ad-in');
      const w = col.querySelector('[data-work]');
      col.insertBefore(el, w);
      toBottom();
    }
    paintRow(id);
  }

  function ask(raw, chip) {
    const text = raw.trim().slice(0, 400);
    const id = current, s = state[id];
    if (!text || s.busy) return;
    if (!chip) s.typed++;
    s.chips = s.chips.filter((c) => c !== text);
    draft = '';
    if (input) { input.value = ''; send.disabled = true; }
    push(id, ['u', text]);
    const r = reply(id, text, chip);
    s.busy = r.step;
    paintRow(id);
    if (id === current) { col.append(work(r.step)); paintChips(); toBottom(); }
    mascot(id, 'busy');
    const wait = 700 + Math.min(1100, r.out.reduce((n, m) => n + JSON.stringify(m).length, 0) * 2);
    setTimeout(() => {
      s.busy = null;
      if (id === current && col) col.querySelector('[data-work]')?.remove();
      if (r.done) push(id, ['s', r.done]);
      r.out.forEach((m, i) => setTimeout(() => push(id, m), i * 140));
      setTimeout(() => {
        if (id !== current) s.unread = true;
        paintRow(id);
        if (id === current && chipsEl) paintChips();
        mascot(id, 'finished');
        setTimeout(() => mascot(id, 'idle'), 3000);
      }, r.out.length * 140);
    }, wait);
  }

  // the bot panel
  function togglePanel(open = !panelOpen) {
    closeMenu();
    panelOpen = open;
    page = null;
    renderPanel(true);
    renderChat();
    if (!open) main.querySelector('.ad-pill')?.focus({ preventScroll: true });
    else panel.querySelector('.ad-p-top button')?.focus({ preventScroll: true });
  }
  let heroBot = null;
  function renderPanel(enter) {
    if (heroBot) { heroBot.destroy(); heroBot = null; }
    panel.hidden = !panelOpen;
    panel.classList.toggle('ad-open', !!enter && panelOpen);
    if (!panelOpen) return panel.replaceChildren();
    const b = BOTS[current], s = state[current];
    panel.setAttribute('role', 'complementary');
    panel.setAttribute('aria-label', `${b.name} details`);
    if (page != null) {
      const r = b.routines[page];
      panel.replaceChildren(
        h('div', { class: 'ad-p-top' }, h('button', { class: 'ad-p-back', type: 'button', 'aria-label': 'Back', onclick: () => { page = null; renderPanel(); panel.querySelector('.ad-routine')?.focus({ preventScroll: true }); } }, icon('back')),
          h('span', { class: 'ad-p-title', text: r.name }), closeBtn()),
        h('div', { class: 'ad-p-body' }, h('div', { class: 'ad-tabpanel ad-in' },
          h('section', null, h('div', { class: 'ad-box' },
            h('div', { class: 'ad-row' }, h('span', { class: 'ad-row-text', text: 'On' }), toggle(page)),
            h('div', { class: 'ad-row' }, h('span', { class: 'ad-row-text', text: 'When' }), h('span', { class: 'ad-row-val', text: r.when })),
            h('div', { class: 'ad-row' }, h('span', { class: 'ad-row-text', text: 'Last run' }), h('span', { class: 'ad-row-val', text: r.last })),
            h('div', { class: 'ad-row' }, h('span', { class: 'ad-row-text', text: 'Next run' }), h('span', { class: 'ad-row-val', 'data-next': '', text: s.on[page] ? next(r.when) : 'Paused' })))),
          h('section', null, h('h4', { class: 'ad-label', text: 'What it does' }), h('div', { class: 'ad-box' }, h('div', { class: 'ad-para', text: r.what })),
            h('p', { class: 'ad-note', text: `To change it, just ask ${b.name} in chat.` })))));
      return;
    }
    const tabs = [['details', 'Details'], ['computer', 'Computer'], ['advanced', 'Advanced']];
    const hero = face(current);
    const tablist = h('div', { class: 'ad-tabs', role: 'tablist', 'aria-label': `${b.name} details`, onkeydown: (e) => {
      const i = tabs.findIndex((t) => t[0] === tab), d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!d) return;
      e.preventDefault();
      tab = tabs[(i + d + tabs.length) % tabs.length][0];
      renderPanel();
      panel.querySelector('.ad-tab[aria-selected="true"]')?.focus({ preventScroll: true });
    } }, tabs.map(([id, label]) => h('button', { class: 'ad-tab', type: 'button', role: 'tab', id: `ad-tab-${id}`, 'aria-selected': String(id === tab), 'aria-controls': 'ad-tabpanel', tabindex: id === tab ? '0' : '-1', text: label, onclick: () => { tab = id; renderPanel(); panel.querySelector('.ad-tab[aria-selected="true"]')?.focus({ preventScroll: true }); } })));
    const body = h('div', { class: 'ad-p-body' },
      h('div', { class: 'ad-hero' }, hero, h('h3', { text: b.name }), h('p', { text: b.role })),
      tablist,
      h('div', { class: 'ad-tabpanel ad-in', id: 'ad-tabpanel', role: 'tabpanel', 'aria-labelledby': `ad-tab-${tab}` }, tab === 'details' ? details(b, s) : tab === 'computer' ? computer(b) : advanced(b)));
    panel.replaceChildren(h('div', { class: 'ad-p-top' }, h('button', { class: 'ad-round', type: 'button', 'aria-label': 'Share and more' }, icon('share')), closeBtn()), body);
    if (window.DuskPixel && hero.querySelector('.px')) {
      try { heroBot = window.DuskPixel.create(hero, { body: row(current).querySelector('svg.bot').dataset.px, seed: ORDER.indexOf(current) * 7 + 3 }); } catch { heroBot = null; }
    }
  }
  const closeBtn = () => h('button', { class: 'ad-round', type: 'button', 'aria-label': 'Close', onclick: () => togglePanel(false) }, icon('x'));
  const next = (when) => (/weekday/.test(when) ? 'Tomorrow, 8:00 AM' : /every day/i.test(when) ? 'Tomorrow, ' + when.split(' at ')[1].replace(' AM', ':00 AM').replace(' PM', ':00 PM') : /6 hours/.test(when) ? 'Today, 6:00 PM' : /first/i.test(when) ? 'Dec 1, 9:00 AM' : when.replace(/^Every /, 'Next ').replace(' at ', ', '));
  function toggle(i) {
    const s = state[current], r = BOTS[current].routines[i];
    return h('button', { class: 'ad-switch', type: 'button', role: 'switch', 'aria-checked': String(s.on[i]), 'aria-label': `${r.name}, ${r.when}`, onclick: (e) => {
      s.on[i] = !s.on[i];
      e.currentTarget.setAttribute('aria-checked', String(s.on[i]));
      const n = panel.querySelector('[data-next]');
      if (n) n.textContent = s.on[i] ? next(r.when) : 'Paused';
      const sub = e.currentTarget.parentElement.querySelector('.ad-row-text > span');
      if (sub) sub.textContent = s.on[i] ? r.when : 'Paused';
    } });
  }
  function details(b, s) {
    const m = model(s.model);
    const pick = h('button', { class: 'ad-model', type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': `Model, ${m[1]}`, onclick: (e) => openMenu(e.currentTarget) }, logo(m), m[1], icon('down'));
    return [
      h('section', null, h('h4', { class: 'ad-label', text: 'Routines' }), h('div', { class: 'ad-box' }, b.routines.map((r, i) => h('div', { class: 'ad-row ad-click' },
        h('button', { class: 'ad-row-text ad-routine', type: 'button', onclick: () => { page = i; renderPanel(); panel.querySelector('.ad-p-back')?.focus({ preventScroll: true }); } }, r.name, h('span', { text: s.on[i] ? r.when : 'Paused' })),
        toggle(i))))),
      h('section', null, h('div', { class: 'ad-box' }, h('div', { class: 'ad-row' }, h('span', { class: 'ad-row-text', text: 'Model' }), pick))),
    ];
  }
  function computer(b) {
    const sc = b.screen;
    const win = h('div', { class: 'ad-win' }, h('div', { class: 'ad-win-top' }, h('i'), h('i'), h('i'), h('span', { text: sc.url })),
      h('div', { class: 'ad-win-body' + (sc.mono ? ' mono' : '') }, sc.title ? h('b', { text: sc.title }) : null,
        sc.rows.map((r) => (Array.isArray(r) ? h('div', { class: 'r' + (r[2] ? ' hi' : '') }, h('span', { text: r[0] }), h('span', { text: r[1] })) : h('div', { text: r || ' ' })))));
    const cursor = h('img', { class: 'ad-cursor', src: '/art/pointer.svg', alt: '', width: 12, height: 17 });
    cursor.style.left = sc.mono ? '62%' : '58%';
    cursor.style.top = sc.mono ? '52%' : '56%';
    return [
      h('section', null, h('div', { class: 'ad-box' }, h('div', { class: 'ad-row' }, h('span', { class: 'ad-row-text', text: `Where ${b.name} works` }), h('span', { class: 'ad-row-val', text: b.where })))),
      h('section', null, h('h4', { class: 'ad-label', text: `${b.name}'s screen` }),
        h('div', { class: 'ad-screen', role: 'img', 'aria-label': `${b.name}'s screen: ${b.now.toLowerCase()}` }, h('div', { class: 'ad-scr-bar' }), win, cursor),
        h('p', { class: 'ad-screen-cap' }, h('span', { class: 'ad-live', text: 'Working' }), ` · ${b.now}`)),
    ];
  }
  function advanced(b) {
    const s = state[b.id];
    const rows = (pairs) => h('div', { class: 'ad-box' }, pairs.map(([k, v]) => h('div', { class: 'ad-row' }, h('span', { class: 'ad-row-text', text: k }), h('span', { class: 'ad-row-val', text: v }))));
    return [
      h('section', null, h('h4', { class: 'ad-label', text: 'Library' }), rows(b.library)),
      h('section', null, h('h4', { class: 'ad-label', text: 'Voice chat' }), rows([['Voice', 'Default'], ['Speed', '1x'], ['Language', 'English']])),
      h('section', null, h('h4', { class: 'ad-label', text: 'This bot' }), rows([['Instructions', b.role], ['What it remembers', `${b.memory} notes`], ['Skills', `${b.skills} on`], ['Model', model(s.model)[1]], ['Working folder', 'Private']])),
    ];
  }

  // the model picker
  function openMenu(btn) {
    if (menu) return closeMenu(true);
    const s = state[current], wrap = btn.closest('.ad-p-body');
    let group = '';
    const items = [];
    const list = h('div', { class: 'ad-menu', role: 'menu', 'aria-label': 'Choose a model' });
    for (const m of MODELS) {
      if (m[3] !== group) { group = m[3]; list.append(h('div', { class: 'ad-menu-h', role: 'presentation', text: group })); }
      const item = h('button', { type: 'button', role: 'menuitemradio', 'aria-checked': String(m[0] === s.model), tabindex: '-1', onclick: () => { s.model = m[0]; closeMenu(); renderPanel(); panel.querySelector('.ad-model')?.focus({ preventScroll: true }); } },
        logo(m), h('span', { text: m[1] }), m[0] === s.model ? icon('check') : null);
      items.push(item);
      list.append(item);
    }
    list.addEventListener('keydown', (e) => {
      const i = items.indexOf(document.activeElement);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus(); }
      else if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); closeMenu(true); }
    });
    let top = btn.offsetTop + btn.offsetHeight + 6, el = btn.offsetParent;
    let right = wrap.clientWidth - (btn.offsetLeft + btn.offsetWidth);
    while (el && el !== wrap) { top += el.offsetTop; right -= el.offsetLeft; el = el.offsetParent; }
    list.style.top = `${top}px`;
    list.style.right = `${Math.max(8, right)}px`;
    wrap.style.position = 'relative';
    wrap.append(list);
    btn.setAttribute('aria-expanded', 'true');
    menu = { list, btn };
    (items.find((x) => x.getAttribute('aria-checked') === 'true') || items[0]).focus({ preventScroll: true });
  }
  function closeMenu(refocus) {
    if (!menu) return;
    menu.list.remove();
    menu.btn.setAttribute('aria-expanded', 'false');
    if (refocus) menu.btn.focus({ preventScroll: true });
    menu = null;
  }
  document.addEventListener('pointerdown', (e) => { if (menu && !menu.list.contains(e.target) && !menu.btn.contains(e.target)) closeMenu(); });

  // which bot, and on phones which screen
  function open(id) {
    closeMenu();
    current = id;
    page = null;
    state[id].unread = false;
    state[id].wait = false;
    if (phone.matches) { app.dataset.view = 'chat'; panelOpen = false; }
    for (const k of ORDER) paintRow(k);
    renderChat();
    renderPanel();
  }
  function showList() {
    app.dataset.view = 'list';
    panelOpen = false;
    renderPanel();
    for (const k of ORDER) paintRow(k);
    row(current).focus({ preventScroll: true });
  }
  for (const r of app.querySelectorAll('.ad-bot')) r.addEventListener('click', () => { open(r.dataset.bot); if (phone.matches) main.querySelector('.ad-back')?.focus({ preventScroll: true }); });
  for (const el of app.querySelectorAll('[data-ic]')) el.append(icon(el.dataset.ic));
  app.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (menu) return;
    if (page != null) { page = null; renderPanel(); }
    else if (panelOpen && phone.matches) togglePanel(false);
  });

  const fit = () => {
    const small = phone.matches;
    root.classList.toggle('ad-phone', small);
    app.style.transform = small ? '' : `scale(${root.clientWidth / 1180})`;
  };
  phone.addEventListener('change', () => {
    closeMenu();
    panelOpen = !phone.matches;
    app.dataset.view = phone.matches ? 'list' : 'chat';
    fit();
    for (const k of ORDER) paintRow(k);
    renderChat();
    renderPanel();
  });
  new ResizeObserver(fit).observe(root);

  app.dataset.view = phone.matches ? 'list' : 'chat';
  fit();
  for (const k of ORDER) paintRow(k);
  renderChat();
  renderPanel();
  // a bot pressed before this ran still opens (browsers that focus buttons on click)
  const early = document.activeElement && document.activeElement.closest && document.activeElement.closest('.ad-bot');
  if (early && app.contains(early)) open(early.dataset.bot);
  // mascot.js (deferred) may land after this; give the panel its moving bot once it has
  if (!window.DuskPixel) addEventListener('load', () => { if (panelOpen && !heroBot && !menu && window.DuskPixel) renderPanel(); }, { once: true });
})();
