// the made-up team the store screenshots show: names, bodies, chats, a room and routines. nothing here reaches a real
// bot or a real service; capture.ts seeds it into a throwaway fixture workspace with a fake engine.

/** chats are [who, text, minutesAgo]; "me" is the person, any other name is a bot */
export const TEAM = [
  {
    name: "Nova", color: "purple", body: "kit", chief: true, pinned: true,
    chat: [
      ["me", "morning! what needs me today?", 48],
      ["Nova", "morning. three things:\n\n1. **sign the lease**, it's in your inbox\n2. two invoices to approve, $1,240 total\n3. Priya asked about thursday, i drafted a reply\n\nwant me to send it?", 47],
      ["me", "yes send it. and move my 4pm to friday", 12],
      ["Nova", "done. Priya has the reply, and your 4pm is now friday at 4. i let Sam know.", 11],
      ["me", "you're the best", 10],
      ["Nova", "i know. go get coffee, i've got the rest.", 9],
    ],
  },
  {
    name: "Pip", color: "blue", body: "pip", pinned: true,
    chat: [
      ["me", "can you book dinner for 4 on friday? thai, near soho, not too loud", 31],
      ["Pip", "checked 12 places nearby. the best three:\n\n- **Saffron House**, 7:45pm, a booth for 4\n- **Ember Room**, 8:00pm, counter seats\n- **Little Lime**, 8:30pm, quieter room\n\nwhich one?", 29],
      ["me", "saffron house!", 27],
      ["Pip", "booked **Saffron House** for 4 at 7:45 on friday. it's on your calendar and i texted the group.", 26],
    ],
    /** a real turn the fake engine holds open, so the chat shows Pip mid-work */
    live: { text: "amazing. can you grab 4 movie tickets for after?", tool: "mcp__browser__navigate", input: { url: "https://tickets.example.com" } },
  },
  {
    name: "Echo", color: "pink", body: "mochi", pinned: true, unread: true,
    chat: [
      ["me", "anything urgent in my inbox?", 64],
      ["Echo", "just one. Maya from Harbour Lets says the flat is yours if you confirm by tonight. the rest i filed or archived.", 63],
      ["me", "reply and say we'll take it, move-in on the 1st", 2],
    ],
    approval: {
      tool: "mcp__gmail__send_an_email",
      title: "Send an email",
      subtitle: "To maya@harbourlets.com\n\nHi Maya, we'd love to take the flat. Could we move in on the 1st? I can sign the lease today.",
    },
  },
  {
    name: "Quill", color: "orange", body: "loaf",
    chat: [
      ["me", "write a short toast for Sam's leaving drinks", 140],
      ["Quill", "here's one: \"to Sam, who fixed every printer, remembered every birthday, and never once replied all. we'll miss you.\"", 138],
    ],
  },
  {
    name: "Rivet", color: "teal", body: "bruin",
    chat: [
      ["me", "the site's down, can you look?", 200],
      ["Rivet", "back up. the certificate expired at 2am; i renewed it and set a reminder for next time.", 196],
    ],
    live: { text: "can you make the blog images load faster too?", tool: "mcp__github__create_pull_request", input: { title: "Smaller blog images" } },
  },
  {
    name: "Tally", color: "yellow", body: "cheep",
    chat: [
      ["me", "how much did we spend on food this month?", 60 * 20],
      ["Tally", "$612 so far, about $90 under last month. most of it is groceries; takeout is down by half.", 60 * 20 - 2],
    ],
  },
  {
    name: "Basil", color: "coral", body: "ribbit",
    chat: [
      ["me", "find 2-bed flats under $3k near the park", 60 * 27],
      ["Basil", "found 3 that fit. the second has the balcony you wanted, viewing saturday at 11.", 60 * 27 - 3],
    ],
    live: { text: "book the saturday viewing and ask about parking", tool: "mcp__browser__navigate", input: { url: "https://flats.example.com" } },
  },
];

export const ROOM = {
  name: "Lisbon trip",
  members: ["Nova", "Pip", "Tally"],
  chat: [
    ["me", "lisbon in may! who's on what?", 22],
    ["Pip", "found direct flights for the 9th to the 13th, $480 each. i'm holding 4 seats until tonight.", 21],
    ["Tally", "with the flat that's $910 a head, under the budget you set.", 20],
    ["Nova", "i'll put it all on the shared calendar and send everyone the plan.", 20],
    ["me", "perfect. book it all", 6],
    ["Pip", "booked. seats 14A to 14D, together.", 5],
  ],
};

const minutes = (h, m = 0) => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
export const ROUTINES = [
  { bot: "Nova", name: "Morning brief", prompt: "brief me on today: calendar, inbox, anything due", schedule: { type: "daily", time: minutes(7), weekdays: [1, 2, 3, 4, 5] } },
  { bot: "Echo", name: "Inbox zero", prompt: "file, archive and summarise my inbox", schedule: { type: "daily", time: minutes(23, 30), weekdays: EVERY_DAY } },
  { bot: "Rivet", name: "Site check", prompt: "check the site is up and the certificate is fine", schedule: { type: "daily", time: minutes(3), weekdays: EVERY_DAY } },
  { bot: "Pip", name: "Flight price watch", prompt: "check the lisbon fares and tell me if they drop", schedule: { type: "daily", time: minutes(6, 30), weekdays: EVERY_DAY } },
  { bot: "Tally", name: "Weekly spend", prompt: "summarise this week's spending", schedule: { type: "daily", time: minutes(18), weekdays: [5] } },
];
