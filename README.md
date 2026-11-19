# roomy

**Makes room on your computer, safely.** Shelly the hermit crab knows all about moving somewhere roomier.

roomy shows how full your disk is, finds the easy things to clear, and clears them with one key.
Everything goes to the **Trash** first, so you can change your mind (press **u**).

```
  roomy   makes room on your computer  ·  29.6 GB free of 494 GB
  ──────────────────────────────────────────────────────────────
   [Shelly]   ████████████████████████████░░░░░░  88% full
              The ticked things below give back 18 GB.

    Easy wins   Biggest folders
  › ● Old installers in Downloads                2.1 GB
    ● App caches                                 6.8 GB
    ● Xcode leftovers                            9.1 GB
    ○ node_modules in old projects               1.2 GB
    ○ Empty the Trash                            4.2 GB
  ──────────────────────────────────────────────────────────────
   Press Enter to clear 18 GB.  Things go to the Trash first, and u puts them back.
```

## Get it

On a Mac, open **Terminal** (press Command + Space, type `Terminal`, press Enter), paste this, and press Enter:

```sh
curl -fsSL https://djp7.pythonanywhere.com/roomy/install.sh | sh
```

Or open **Project CLI Access** (`pca`) and pick Shelly's card.

## Use it

Type `roomy` and press Enter.

| Key | What it does |
| --- | --- |
| ↑ ↓ | choose a row |
| Space | tick or untick it |
| Enter | clear everything ticked |
| u | put back what roomy just cleared |
| → | **Biggest folders**: see what's taking space; Enter looks inside, **t** moves one to the Trash, **o** shows it in Finder |
| q | quit |

`roomy check` lists what could be cleared without changing anything. `roomy putback` puts the last
clear back.

## What it clears

| | Why it's safe |
| --- | --- |
| Old installers in Downloads | .dmg, .pkg, .zip… older than a month: the app is already installed |
| App caches | apps make them again when they need them (Apple's own are left alone) |
| Xcode leftovers | build files Xcode remakes by itself |
| Saved downloads from Homebrew, npm and pip | they download again if needed |
| node_modules in old projects | only in projects untouched for 3 months; `npm install` brings them back (not ticked for you) |
| Empty the Trash | the only thing that can't be undone, so it's never ticked for you and roomy asks first |

roomy only looks inside your home folder, never follows links, and never deletes anything except
when you choose to empty the Trash. It works on Macs and Linux.
