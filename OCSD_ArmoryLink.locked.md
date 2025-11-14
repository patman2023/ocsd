# OCSD ArmoryLink – Locked Behaviors

This file records behaviors that are confirmed working and must not be changed
without an explicit request from the user.

## How to Read This File
- Each section describes a feature that is currently working as intended.
- "Do Not Break" explains what must remain true.
- "Implementation Notes" explains roughly how it works in the code today.
- Only change or remove a section if the user explicitly says to.

---

## ServiceNow Workspace Tab Titles
**Status:** Locked ✅
**Module(s):** tabTitle, pageState, fields

**Do Not Break:**
- Tab labels for ServiceNow Workspace tabs are formatted as `ICON | LASTNAME` where:
  - ICON is an emoji representing the Type field: 🟡 (Deployment), 🟢 (Return), ⚫ (default/unknown)
  - LASTNAME is extracted from the User field (last name only, or "Unknown" if not found)
- Each ServiceNow tab maintains its own context and displays the correct label for that specific page/record
- Tab labels update automatically when:
  - The Type field changes (monitored via MutationObserver on shadow DOM combobox)
  - The User field changes (monitored via change/input events)
  - The user switches between tabs (detected via MutationObserver on `.is-selected` class)
  - Periodic refresh every 2 seconds as backup
- Tab switches trigger a refresh with retry logic (5 attempts with delays) to ensure fields load before reading
- Tab label element is located using `.sn-chrome-one-tab.is-selected .sn-chrome-one-tab-label`

**Implementation Notes (for you, Claude):**
- Tab title module (`AL.tabTitle`) handles formatting and updating the tab label text
- Page state module (`AL.pageState`) manages per-page context storage in `pages` object
- Each page is identified by a stable `pageId` computed from:
  1. URL params (`sysparm_sys_id` or `sys_id`) combined with path: `${path}::${sysId}`
  2. Fallback: iframe content URL sys_id
  3. Last resort: generated ID stored in tab element's `dataset.alPageId`
- Context includes: `type`, `typeIcon`, `userFull`, `userLast`, and other field values
- `readFieldsAndUpdate()` reads all fields and stores them in the active page context
- `extractLastName()` handles name parsing (comma-separated or space-separated)
- Tab title updates by calling `AL.tabTitle.update()` which reads from active page context
- MutationObserver watches for `.is-selected` class changes on tabs to detect switches
- Click events on tabs trigger `AL.pageState.onTabSwitch()` with retry logic

**Last Updated:** 2025-11-14

---

## Field Selectors and Active Page Reading
**Status:** Locked ✅
**Module(s):** fields, pageState, utils

**Do Not Break:**
- Field values are read from ServiceNow forms using specific aria-label selectors:
  - `type`: `button[role='combobox'][aria-label='Type']` - Special shadow DOM handling
  - `user`: `input[aria-label='User']`
  - `vehicle`: `input[aria-label='Vehicle Asset']`
  - `weapon`: `input[aria-label='Weapon Asset']`
  - `taser`: `input[aria-label='Taser Asset']`
  - `patrol`: `input[aria-label='Patrol Assets']`
  - `controlOneRadio`: `input[aria-label='Control One Radio']`
  - `comments`: `textarea[name='comments']`
  - `updated_on`: `input[name='sys_updated_on-date']`
- Type field requires special handling because it's a shadow DOM combobox:
  - Read: Extract text from `.now-select-trigger-label` element inside the combobox button
  - Write: Click to open dropdown, find matching `[role="option"]`, then click it
- Active page context is refreshed on initialization and tab switches using `refreshActivePage()`
- Field reading uses `AL.utils.findElement()` which searches both regular DOM and shadow DOM
- Each field configuration has: `key`, `label`, `selector`, `selectorPath`, `kind`, `roles`, `commitEvent`, `enabled`
- Fields are stored in `AL.fields.fields` array and persisted to localStorage via `AL.persistence`
- Default fields are merged with saved configs (missing defaults are added back automatically)

**Implementation Notes (for you, Claude):**
- `AL.fields.getFieldValue(key)` is the main read function
  - Finds field config by key
  - Locates element using `AL.utils.findElement(field.selector, field.selectorPath)`
  - For Type field: reads from `.now-select-trigger-label` or falls back to `textContent`/`aria-label`
  - For SELECT: returns option text (not value)
  - For INPUT/TEXTAREA: returns `.value`
  - For others: returns `.textContent`
- `AL.pageState.readFieldsAndUpdate()` reads all enabled fields and updates active page context
  - Called during `refreshActivePage()` which runs on init and tab switches
  - Safely checks if fields module is ready before reading
  - Extracts lastName using `extractLastName()` helper
  - Derives `typeIcon` based on type value (deploy/return/default)
- `AL.utils.findElement(selector, selectorPath)` searches:
  - Shadow DOM trees if `selectorPath` is provided
  - Falls back to regular `querySelector` if shadow search fails
  - Used by both field reading and field writing operations
- Field monitoring attaches change/input listeners and MutationObservers to track field changes
- Retry mechanism ensures field elements are found even if DOM loads slowly

**Last Updated:** 2025-11-14

---

<!-- Additional locked features will be added below as they are confirmed working -->
