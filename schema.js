// Generated layout of the planner's Google Sheet. Column order matters; header text doesn't.
export const TABS = {
 "Week": {
  "keys": [
   "date",
   "day",
   "breakfast",
   "lunch",
   "dropoff",
   "pickup",
   "snack",
   "activity",
   "driver",
   "homework",
   "hwNote",
   "dinner",
   "cook",
   "clean",
   "table",
   "bedtime",
   "bedNote",
   "shopper",
   "errands",
   "notes"
  ],
  "labels": [
   "Date",
   "Day",
   "Breakfast",
   "Lunch",
   "Dropoff",
   "Pickup",
   "After-school snack",
   "Activities",
   "Activities driver",
   "Homework helper",
   "Homework due",
   "Dinner",
   "Cook",
   "Clean up",
   "Kids' table job",
   "Bedtime",
   "Bedtime note",
   "Grocery run",
   "Errands",
   "Notes"
  ]
 },
 "Groceries": {
  "keys": [
   "id",
   "name",
   "type",
   "forWhat",
   "who",
   "got",
   "createdAt"
  ],
  "labels": [
   "id",
   "Item",
   "Aisle",
   "For",
   "Who's getting it",
   "Got it",
   "Added"
  ]
 },
 "Stars": {
  "keys": [
   "id",
   "week",
   "kid",
   "job",
   "d0",
   "d1",
   "d2",
   "d3",
   "d4",
   "d5",
   "d6"
  ],
  "labels": [
   "id",
   "Week of",
   "Kid",
   "Job",
   "Mon",
   "Tue",
   "Wed",
   "Thu",
   "Fri",
   "Sat",
   "Sun"
  ]
 },
 "Checkins": {
  "keys": [
   "id",
   "date",
   "who",
   "good",
   "hard",
   "tryThis",
   "createdAt"
  ],
  "labels": [
   "id",
   "Date",
   "Who",
   "What was good",
   "What was hard",
   "We'll try",
   "Added"
  ]
 },
 "Rhythm": {
  "keys": [
   "id",
   "time",
   "what",
   "duty",
   "kids"
  ],
  "labels": [
   "id",
   "Time (24h)",
   "What happens",
   "Grown-up on duty",
   "Kids do"
  ]
 },
 "Rules": {
  "keys": [
   "id",
   "text"
  ],
  "labels": [
   "id",
   "Rule"
  ]
 },
 "Snacks": {
  "keys": [
   "id",
   "name",
   "kind",
   "self",
   "like1",
   "like2",
   "order"
  ],
  "labels": [
   "id",
   "Snack",
   "Kind",
   "Kids can make it",
   "Kid 1 picked",
   "Kid 2 picked",
   "Order"
  ]
 },
 "Jobs": {
  "keys": [
   "id",
   "area",
   "name",
   "often",
   "order",
   "lv1",
   "lv2"
  ],
  "labels": [
   "id",
   "Area",
   "Job",
   "How often",
   "Order",
   "Kid 1 level",
   "Kid 2 level"
  ]
 },
 "Rewards": {
  "keys": [
   "id",
   "stars",
   "text"
  ],
  "labels": [
   "id",
   "Stars needed",
   "Reward"
  ]
 },
 "People": {
  "keys": [
   "id",
   "role",
   "name"
  ],
  "labels": [
   "id",
   "Role",
   "Name"
  ]
 },
 "Settings": {
  "keys": [
   "key",
   "value"
  ],
  "labels": [
   "Setting",
   "Value"
  ]
 }
};

export const WHO_COLUMNS = {"Week": ["dropoff", "pickup", "driver", "homework", "cook", "clean", "bedtime", "shopper"], "Groceries": ["who"], "Checkins": ["who"]};

// Starter rows for try-it mode, and for any tab missing from your sheet.
export const STARTER = {"Week": [], "Groceries": [], "Stars": [], "Checkins": [], "Rhythm": [["r1", "15:15", "Pick-up, home", "See Week plan", "Shoes off, bags on hooks, lunchbox to the sink"], ["r2", "15:30", "Snack and move", "", "Eat snack, then play outside or run around for 20 minutes"], ["r3", "16:00", "Homework time", "", "Kitchen table, timer on. Reading if there’s no homework"], ["r4", "16:30", "Kid jobs", "", "Room reset, cats, laundry job (see Kids’ stars)"], ["r5", "16:45", "Free play", "", "Their choice. Screens OK once homework and jobs are done"], ["r6", "17:45", "Help with dinner", "Dinner cook", "Set the table, one kitchen helper job"], ["r7", "18:00", "Family dinner", "Everyone", "One “good thing today” each"], ["r8", "18:40", "Clean up", "Clean-up person", "Clear own plate, wipe own spot"], ["r9", "19:00", "Family wind-down", "Everyone", "Screens off. Games, drawing, cuddles with the cats"], ["r10", "19:30", "Bath, PJs, teeth", "", "Mark today’s stars with a grown-up"], ["r11", "19:45", "Stories", "", "Reading in bed"], ["r12", "20:15", "Lights out", "", ""]], "Rules": [["u1", "First homework and jobs, then screens. Every day, no negotiating."], ["u2", "Homework gets a timer. When it rings, we stop and ask a grown-up for help instead of melting down."], ["u3", "If the day goes sideways (late activity, sick kid), skip straight to wind-down. Bedtime wins."], ["u4", "Grown-ups follow the wind-down too: phones away from 7:00."]], "Snacks": [["s1", "Apple slices and peanut butter", "Fruit and protein", "With help", "", "", 1], ["s2", "Carrots or cucumber with hummus", "Veggie and protein", "Yes", "", "", 2], ["s3", "Cheese stick and whole-grain crackers", "Protein and grain", "Yes", "", "", 3], ["s4", "Yogurt with berries and granola", "Dairy and fruit", "Yes", "", "", 4], ["s5", "Banana “sushi” (PB and tortilla roll)", "Fruit and grain", "With help", "", "", 5], ["s6", "Hard-boiled egg", "Protein", "Yes", "", "", 6], ["s7", "Frozen grapes", "Fruit", "Yes", "", "", 7], ["s8", "Popcorn (air-popped)", "Whole grain", "With help", "", "", 8], ["s9", "Ants on a log (celery, PB, raisins)", "Veggie and protein", "Yes", "", "", 9], ["s10", "Smoothie", "Fruit and dairy", "With help", "", "", 10], ["s11", "Edamame", "Protein", "Yes", "", "", 11], ["s12", "Make-your-own trail mix", "Mixed", "Yes", "", "", 12], ["s13", "Mini whole-wheat quesadilla", "Grain and protein", "With help", "", "", 13], ["s14", "Cottage cheese and pineapple", "Dairy and fruit", "Yes", "", "", 14], ["s15", "Snap peas with yogurt ranch dip", "Veggie", "Yes", "", "", 15], ["s16", "Oatmeal energy bites", "Grain", "Make together on Sunday", "", "", 16]], "Jobs": [["j1", "Laundry", "Dirty clothes in the hamper", "Every day", 1, "Helper", "Helper"], ["j2", "Laundry", "Hamper to the laundry room", "Laundry day", 2, "Helper", "Helper"], ["j3", "Laundry", "Fold and put away my clothes", "Laundry day", 3, "Helper", "Helper"], ["j4", "My room", "Make my bed", "Every day", 4, "Helper", "Helper"], ["j5", "My room", "Floor clear, toys away before dinner", "Every day", 5, "Helper", "Helper"], ["j6", "My room", "Lay out tomorrow’s clothes", "Every day", 6, "Helper", "Helper"], ["j7", "Our cats", "Fresh water in the cat bowl", "Every day", 7, "Helper", "Helper"], ["j8", "Our cats", "Feed the cats (with a grown-up)", "Every day", 8, "Helper", "Helper"], ["j9", "Our cats", "10 minutes of brushing or play with the cats", "Every day", 9, "Helper", "Helper"]], "Rewards": [["r0", 0, "Keep going, you’ve got this!"], ["r1", 30, "Pick Friday’s family movie"], ["r2", 50, "Pick a dinner and dessert"], ["r3", 70, "Special outing with one grown-up"]], "People": [["m1", "Grown-up", "Parent 1"], ["m2", "Grown-up", "Parent 2"], ["k1", "Kid", "Kid 1"], ["k2", "Kid", "Kid 2"], ["all", "Everyone", "Everyone"]], "Settings": [["shop_who", ""], ["shop_when", ""]]};
