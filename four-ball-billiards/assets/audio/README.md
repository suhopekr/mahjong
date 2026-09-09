# Audio

| file | role | used for |
|---|---|---|
| `impact-01.mp3` | `impact` | ball on ball |

## Why the alkkagi sample and not a billiard recording

The go-stone click is a short, hard, high transient with almost no tail —
which is exactly what a phenolic carom ball is. Two resin balls meeting is
one of the cleanest impacts in any sport, and the stone sample already had
the right envelope, the right brightness and (this is the part that is
expensive to get right) a level that had been balanced against
`core/audio.js`'s synthesised fallback voice. Recording new ones would
have meant re-tuning that balance to arrive at the same place.

## Why there is no cushion sample

There WAS one: StoneFlick's `obstacle-01.mp3`, a go stone against a fixed
wooden peg, borrowed on the theory that both are a hard thing striking a
fixed thing that absorbs rather than rings. It is the wrong sound and it
is wrong in an obvious way once you hear it next to a real table: a peg
CLICKS. A cushion is vulcanized rubber under a cloth jacket and it
swallows the ball — no transient worth the name, no ring afterwards, all
the energy in a low flex that sags in pitch as the rubber gives.

That is a sound with two layers and no third, so `core/audio.js`
`playCushionSound()` synthesises it directly rather than approximating it
with a recording of something else. The file was deleted; nothing in this
game plays the `obstacle` role.

`cushion` is still a role, so dropping a real `cushion-01.mp3` in here
takes over from the synthesis with no code change. That is the upgrade
path if a good recording turns up.

## Adding files

`core/samples.js` maps a filename to a role by its prefix (`impact-02.mp3`
is another `impact` variant) and falls back to the synthesised voice when
a role has no files. Run `npm run audio:manifest` after adding any.

Licensing note carried over with the file: see StoneFlick's
`assets/audio/README.md` for the source and licence.
