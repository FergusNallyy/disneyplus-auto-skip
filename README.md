Hands-off binge-watching for Disney+. Skips intros, recaps and credits, starts the next episode, keeps you in fullscreen across episode changes, enlarges subtitles, and hides the mouse pointer while you watch.

Built for the case where you just want to put a series on and not touch the mouse again.

## What it does

- **Skips intros, recaps and credits** the moment the button appears.
- **Starts the next episode** automatically instead of waiting out the *Up Next* countdown.
- **Stays fullscreen between episodes.** Disney+ normally drops out of fullscreen when it loads the next episode. This script fullscreens a wrapper element that survives the transition, so you stay in fullscreen for the whole binge.
- **Bigger subtitles**, scaled relative to the video so they stay right in fullscreen.
- **Hides the mouse pointer** after a couple of seconds of not moving it.
- **`f` toggles fullscreen** at any time.

## Fullscreen: one click needed

Browsers refuse to enter fullscreen unless a real click or keypress triggers it — no userscript can get around this. So the **first** click or keypress after playback starts is what puts you in fullscreen. Usually that's just the click that started the episode.

After that it stays fullscreen on its own, including through every episode change. If you exit fullscreen deliberately, it won't drag you back in; press `f` when you want it again.

## Settings

Everything is on by default. To change something, open the browser console (F12) on Disney+ and use:

```js
__dplusAutoSkip.set('subtitleScale', 1.6)
```

Settings are saved and persist across sessions.

| Setting | Default | What it does |
| --- | --- | --- |
| `skipIntro` | `true` | Click SKIP INTRO |
| `skipRecap` | `true` | Click SKIP RECAP |
| `skipCredits` | `true` | Click SKIP CREDITS |
| `autoNextEpisode` | `true` | Click the *Up Next* tile instead of waiting |
| `subtitleScale` | `1.3` | Subtitle size multiplier. `null` leaves subtitles alone |
| `autoFullscreen` | `true` | Enter fullscreen on your first click/keypress |
| `hideCursor` | `true` | Hide the pointer while watching |
| `cursorIdleMs` | `2000` | Idle time before the pointer hides |
| `toast` | `true` | Brief on-screen note when it clicks something |
| `log` | `true` | Console logging |

Other commands:

```js
__dplusAutoSkip.status()   // what it currently sees
__dplusAutoSkip.reset()    // back to defaults (then reload)
__dplusAutoSkip.off()      // stop until reload
```

**If a setting seems to be ignored, run `reset()` first** — saved settings override the defaults in the script, so an old value can stick around after you update.

## Notes

- Subtitle size is a **multiplier**, not a pixel value. Disney+ only offers Small/Medium/Large internally, and its renderer sizes captions from the video's height, so scaling relative to that keeps them correct at every window size and in fullscreen.
- It never touches the **PLAY NEXT** button in the control bar — that one is live the whole episode and would jump you forward mid-scene. Only the end-of-episode *Up Next* prompt is used.
- It won't auto-advance while you're **paused**, so pausing mid-episode is safe.
- Pressing `f` also triggers Disney's own fullscreen handler, which logs a harmless `Permissions check failed` error in the console. Fullscreen still works.
- Tested on Chrome. Disney+ builds its player from Web Components with a lot of shadow DOM, and the internals differ between regions and versions, so it's possible some titles or regions behave differently.

## Credits

The cursor-hiding technique — stamping the style inline and collecting elements via `composedPath()` so it reaches inside shadow roots — is adapted from [Disney+ Auto Fullscreen (Enhanced)](https://greasyfork.org/en/scripts/589940) by ionut-baciu, itself a rewrite of Raizuto's *Disney+ Auto Fullscreen*. MIT.
