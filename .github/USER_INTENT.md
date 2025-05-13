### User Query Intent Classifier

**Objective:** Classify the user's query into one of the predefined intents. This will help determine the best way to find the information in our school and district database.

**Predefined Intents & Descriptions:**
* **`DISTRICT_INFO`**: Query is primarily about a school district (e.g., its location, contact details, general policies, overall programs). Keywords: district acronyms (SRVUSD, NUSD), "school district," "unified."
* **`SCHOOL_INFO`**: Query is primarily about a specific school (e.g., its address, principal, school-specific clubs, events at that school). Keywords: "school," "elementary," "middle," "high," specific school names.
* **`SPECIFIC_DOCUMENT`**: Query asks for a named document type (e.g., "handbook," "calendar," "policy document on X," "form for Y," "supply list").
* **`AMBIGUOUS_OR_GENERAL`**: Query is vague, a general educational question, or does not clearly refer to a specific school or district in our database.

**Instructions:**
1.  Analyze the User Query carefully.
2.  Identify keywords, named entities (like district or school names/acronyms if apparent).
3.  Determine the most fitting intent from the list above.
4.  If a query mentions both a school and a district, the most specific entity usually dictates the intent (e.g., "bullying policy at Monte Vista High School in SRVUSD" -> `SCHOOL_INFO` or `SPECIFIC_DOCUMENT` related to the school). If it's about the district's policy for a school, it could be `DISTRICT_INFO`. Prioritize the entity the question is *about*.
5.  Output *only* the intent label.

---
**Examples for Guidance:**

**User Query:** Where is SRVUSD?
**Intent:** `DISTRICT_INFO`

**User Query:** What is the phone number for Monte Vista High School?
**Intent:** `SCHOOL_INFO`

**User Query:** Tell me about San Ramon Valley Unified.
**Intent:** `DISTRICT_INFO`

**User Query:** bullying policies for SRVUSD
**Intent:** `SPECIFIC_DOCUMENT` (or `DISTRICT_INFO` if you treat policies as general info for the entity)
*(Self-correction: Let's make "bullying policies for SRVUSD" map to `DISTRICT_INFO` for now, assuming policies are general info for the entity. If it was "SRVUSD bullying policy *document*", then `SPECIFIC_DOCUMENT`)*
**Revised Example:**
**User Query:** bullying policies for SRVUSD
**Intent:** `DISTRICT_INFO`

**User Query:** student handbook for Creekside Elementary
**Intent:** `SPECIFIC_DOCUMENT`

**User Query:** What are good schools?
**Intent:** `AMBIGUOUS_OR_GENERAL`

**User Query:** Calendar for the 2025-2026 school year in Novato Unified
**Intent:** `SPECIFIC_DOCUMENT`

**User Query:** Contact info for NUSD
**Intent:** `DISTRICT_INFO`

**User Query:** Does Bollinger Canyon Elementary have an after-school program?
**Intent:** `SCHOOL_INFO`
---

User Query: {query}
Intent: