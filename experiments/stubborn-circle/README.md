# Experiment 01 — The Stubborn Circle

## Question

Can a personality appear from **recovery behavior alone**, before we give the thing a face, dialogue, backstory, or even a name?

The subject begins as a perfect circle.

The world is allowed to deform it. The subject is not allowed to *stay* deformed.

That is the whole character premise.

## First cartoon beat

A circle crosses a clean horizontal field from left to right.

1. **Normal** — it rolls/bobs with almost no performance.
2. **Narrow gap** — the environment squeezes it vertically into a tall oval.
3. **Release** — it snaps back toward a circle.
4. **Slope** — gravity/velocity stretches it slightly along the direction of travel.
5. **Hard interruption** — one last compression is held longer than feels comfortable.
6. **Recovery** — instead of a perfect elastic return, it overshoots once, becomes *too round / too proud*, then settles.

No face. No eyes. No arms. No caption.

The question is whether we read the recovery as temperament.

## The tinker loop

Do not choose one animation by intuition. Build a sweep.

### Axis A — recovery time

How long after force removal before the silhouette returns to its canonical circle?

- 0.04 s
- 0.08 s
- 0.14 s
- 0.22 s
- 0.36 s
- 0.55 s

### Axis B — overshoot

How far past canonical roundness does the recovery travel?

- 0.00
- 0.03
- 0.07
- 0.12
- 0.20

### Axis C — hold / stubbornness

How long can external deformation persist before the circle begins resisting it?

- immediate resistance
- 2 frames
- 4 frames
- 8 frames
- 12 frames

Start with one-axis sheets. Only make a grid after each axis has a readable effect.

## What I am looking for

Not "the smoothest" or "the nicest."

I want the variant where the circle appears to have an opinion about what just happened to it.

Possible readings:

- **fast + no overshoot** → competent / mechanical
- **fast + overshoot** → indignant / proud
- **slow + overshoot** → dramatic
- **slow + no overshoot** → tired / resigned
- **delayed resistance + sharp recovery** → patient until suddenly not

Those are hypotheses, not labels to bake into the system. The pictures decide.

## Why this is a runtime experiment

Current .geo v0/v0.1 deliberately refuses pose keys on solids. That is a useful constraint, but it means the simplest version of this experiment cannot yet be expressed honestly: a `ball` solid cannot animate its silhouette.

I do **not** want to fake this with an unrelated mechanism just to get a picture.

The experiment therefore asks for the smallest useful authoring extension:

> A bounded solid deformation channel whose maximum geometry cost is unchanged and whose canonical rest state is explicit.

The desired behavior is still completely bounded: the topology does not change; only existing solid profile parameters vary over plan time.

## Minimal extension candidate

This is intentionally narrower than "animate arbitrary solids."

Add optional pose channels for a solid:

- `scale_x`
- `scale_y`
- optionally `scale_z`

or, if the profile system already has a cleaner native parameterization, expose the smallest equivalent set.

Rules:

- values are finite scalars only;
- no topology changes;
- no additional vertices or indices;
- interpolation uses the existing plan/ease path;
- omitted values mean canonical 1.0;
- compile-time ceiling is therefore identical to the undeformed solid.

For this experiment, preserving area/volume can live in the authoring layer:

`scale_x = 1 / sqrt(scale_y)` (2-D-feeling squash) or an equivalent 3-D compensation.

## Intended cast syntax (NOT VALID v0.1)

This is a target document for discussion, not something the current compiler should silently accept.

```json
{
  "name": "stubborn-circle-01",
  "style": "flat",
  "dw": 1,
  "poses": {
    "round": {
      "body": { "scale_x": 1.0, "scale_y": 1.0 }
    },
    "squeezed": {
      "body": { "scale_x": 1.28, "scale_y": 0.61 }
    },
    "proud": {
      "body": { "scale_x": 0.96, "scale_y": 1.09 }
    }
  },
  "plan": [
    { "pose": "round",    "t": 0.00 },
    { "pose": "squeezed", "t": 0.72 },
    { "pose": "squeezed", "t": 0.92 },
    { "pose": "proud",    "t": 1.03 },
    { "pose": "round",    "t": 1.16 }
  ],
  "parts": [
    {
      "id": "body",
      "kind": "solid",
      "y": [0.30, 0.70],
      "w": 0.20,
      "shape": "ball",
      "a": "A",
      "b": "A"
    }
  ]
}
```

## Success condition

We stop when two things are true:

1. A sweep shows visibly distinct recovery temperaments while everything except one parameter is held constant.
2. Sean and ChatGPT can point to a variant and discuss *what the motion seems to want next* without first inventing lore for it.

If that happens, the experiment has produced the beginning of a character rather than merely a squash-and-stretch test.
