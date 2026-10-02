# Stubborn Circle — lab notes

## 01a · recovery time

The first sweep established that the runtime can vary a solid's silhouette
without changing topology or its declared arena ceiling.

The useful creative observation was not "faster is better." Very fast recovery
(~0.04 s) largely erases the event and reads mechanically. Very slow recovery
(~0.55 s) lets the deformation dominate long enough to suggest yielding,
fatigue, or material softness. The middle band (~0.14–0.22 s) leaves enough
memory of the squeeze for the *return* to register as behavior.

Working value for the next tests: **0.14 s**.

## 01b · overshoot amount

With recovery timing held fixed, increasing the tall/narrow overshoot makes the
return more legible as an action. In the still sheet, 0.14–0.22 becomes so
visibly elongated that the shape change starts calling attention to itself as
deformation. 0.05–0.09 stays closer to the canonical body while still producing
a distinct second gesture.

Working value for the next test: **0.09**.

### New question

Immediate overshoot is still easy to explain as spring physics.

What if the circle returns to perfect roundness, **waits**, and only then makes
the same tiny proud stretch?

That pause is interesting because no new shape vocabulary is involved. Only the
temporal relationship changes. If a small delay makes the same motion read as
an afterthought — a little "hmph" — then perceived agency is emerging from
timing alone.

## 01c · afterthought

Sweep one variable: pause at canonical roundness before the 0.09 overshoot.

Values: 0.00, 0.04, 0.08, 0.14, 0.22, 0.36 seconds.

Hypothesis:

- 0.00 should read as elasticity.
- a short pause may read as composure / decision.
- too long a pause should break causal continuity and make the second gesture
  feel unrelated.

This is the first experiment aimed explicitly at finding the boundary between
**material behavior** and **character behavior**.


## 02 · visible cause

The first three tests isolate the subject. That is useful for measurement, but
it leaves a loophole: a viewer can explain every motion as material physics
because nothing on screen visibly *did* anything to the circle.

The next test adds two simple paddles. They close, squash the circle, and leave.
Then two performances are shown side by side:

- no pause before the 0.09 proud gesture;
- a 0.14 s pause at perfect roundness before the identical gesture.

Nothing else changes.

This is deliberately a tiny cartoon rather than another abstract material test.
The question is whether **causal staging + a beat of empty time** is enough to
turn the exact same shape change into a reaction.


## 04 · memory without a face

The answer-direction test suggests a stronger question than "which gesture has
more attitude?"

Can the subject appear to **remember**?

The setup repeats the exact same pressure event twice. The first event is
identical across all variants. On the second approach, before the paddles touch:

- **NAIVE** stays round.
- **BRACE** grows taller, into the direction of the incoming pressure.
- **YIELD** pre-squashes, beginning the demanded deformation voluntarily.

The second squeeze itself is identical again.

This matters because the character claim no longer lives in a single motion.
It lives in the relationship between two moments separated in time. If a viewer
reads BRACE as defiance or YIELD as apprehension/cooperation, then the runtime is
supporting a primitive form of narrative memory without adding a face, symbol,
or explicit state label.

A useful failure would be equally informative: if all three still read as
arbitrary elasticity, then shape change alone may not carry expectation strongly
enough, and the next creative need is likely **translation** — the ability for a
solid to lean, dodge, approach, or choose a place in the frame.


## 05 · spatial choice

The memory test did not fail. BRACE and YIELD separate visibly before the
second contact: the same environment can make the subject appear to anticipate
what is about to happen.

That creates the next constraint.

With scale alone, memory can only change **how the subject receives the event**.
It cannot change whether the event happens. The character can brace or yield,
but it cannot leave.

So the creative need now asks for one new spatial primitive:
`offset_x` on solids. It is deliberately only horizontal translation. No
general transform stack, no arbitrary matrix, no new topology.

The first use is a tiny causal joke:

1. the circle is squeezed once;
2. the same paddles approach again;
3. STAY remains centered and is squeezed;
4. DODGE moves sideways first;
5. the paddles close on empty space.

The interesting question is no longer "does this look alive?" It is whether
**history changes blocking**. That is much closer to storytelling: the meaning
of a place in the frame depends on what happened earlier.


## 06 · decision latency

Spatial choice produces a new kind of read immediately: the second press can
close on empty space. The subject is no longer only reacting to force; it can
change the blocking of the event.

Now hold the destination and travel time fixed and sweep **when it commits**.

Dodge lead before contact: 0.36, 0.28, 0.20, 0.14, 0.08 seconds.
Travel time: 0.14 seconds.

The question is whether timing alone separates attitudes:

- very early may feel cautious or experienced;
- near-contact may feel confident, playful, or reckless;
- too late should visibly lose the clean escape.

Do not name a winner in code. The animation is the measurement.


### Visual check caught a timing lie

The first 06 render exposed an authoring bug rather than a character result.
For the 0.08 s lead lane, a shared "closed-away" beat placed the body fully
clear at contact even though the declared travel time was 0.14 s. The picture
made the contradiction obvious: the supposedly late dodge accelerated itself
to satisfy the staging.

The experiment now samples the body's true in-flight position at contact and
continues the move afterward when necessary. This is exactly why the visual
loop stays upstream of interpretation: do not write a personality explanation
for an animation the program did not actually perform.


## 07 · a witness

The spatial experiments make one thing clear: a character can remember an
event by changing where it puts itself the next time.

The next question is social.

Add a second, untouched body. Squeeze only the first. Once the mechanism is
fully gone and there has been an empty beat, the witness does one of three
things: **STILL**, **CLOSER**, or **AWAY**.

No eyes. No arms. No dialogue. The witness never gets touched.

If those variants produce different reads, relationship is emerging from
blocking and timing alone. That would be a larger step than finding an
individual temperament, because the meaning is no longer contained in either
shape. It exists between them.


## 08 · reply to the witness

07 separates cleanly enough to ask a stronger question. **CLOSER** and **AWAY**
are not interesting because they are translations; they are interesting because
the translation happens *after something happened to somebody else*. The
movement inherits meaning from sequence.

Now make the relation two-way.

The subject is squeezed. The untouched witness waits until the mechanism is
gone, then moves closer. After another empty beat, only the subject's reply
changes:

- **STILL** — no second move;
- **TOWARD** — subject closes some of the remaining gap;
- **AWAY** — subject increases it.

The hypothesis is not "toward means comfort" or "away means fear." Those words
would get ahead of the picture. The narrower question is whether a second move
can read as an **answer to the first move**.

If it does, this little grammar has dialogue before it has language.


## 09 · role reversal / callback

08 asks whether one movement can answer another. 09 stretches that across a
larger piece of time.

There are now two pressure stations and two bodies. First the left body is
squeezed; after the mechanism opens, the right body leaves its own station,
moves toward it, waits, then returns. Later the roles reverse and the right body
is squeezed.

Only then do we branch the left body's response: **STILL**, **TOWARD**, or
**AWAY**.

Nothing in the last movement is visually novel. That is the point. If TOWARD
feels different now than it did in an isolated translation test, the extra
meaning is being carried by a callback to something the audience saw earlier.

That is a storytelling primitive I care about: **repetition changes the meaning
of the same motion**.


## 10 · expectation makes absence visible

The role-reversal test is the first one that starts to feel structurally like a
story rather than a reaction study. A movement can echo a movement from much
earlier in the piece.

So establish the rule twice before asking anything new:

1. left is squeezed -> right visits;
2. right is squeezed -> left visits.

Then squeeze left again.

- **AFTER** repeats the established response after release;
- **EARLY** starts the visit while the squeeze is still happening;
- **NONE** stays where it is.

The interesting possibility is NONE. In isolation it contains no performance at
all. But after two demonstrations of a reciprocal pattern, the audience may
supply the missing movement as an expectation. If so, *not moving* has become a
legible choice.

That would mean the runtime can make absence visible by giving time a memory.


## 11 · joint choice

10 makes a peculiar thing available: after repetition, the audience can carry a
rule that is not drawn anywhere.

Now put both bodies under the same threat at the same time, after the reciprocal
history has already been established.

- **STAY** — both remain and both deform.
- **CENTER** — both leave their stations toward the shared middle.
- **OUTSIDE** — both leave away from each other.

CENTER and OUTSIDE have the same mechanical success: two empty presses. The
variable is almost entirely relational geometry.

If CENTER feels meaningfully unlike OUTSIDE, then "together" is not a costume,
face, or line of dialogue. It is a direction in space chosen at the same time.


## 12 · first sentence

Stop asking the grammar isolated questions for one pass and try to **say
something with it**.

This is not a storyboard and it is not a final. It is the first compositional
experiment built only from behaviors the tinker loop already made legible:

pressure -> witness -> reciprocity -> memory -> shared spatial choice.

The staging is cleaned up from the diagnostic tests: the bodies are genuinely
round in front view, the pressure stations are narrower and farther apart, and
the final inward escape aims for contact rather than the overlap that showed up
in 11 CENTER.

Sequence:

1. left is squeezed; right visits after release;
2. right is squeezed; left returns the visit;
3. both presses close together; both bodies leave inward;
4. the presses close on empty stations;
5. after an empty beat, the two bodies make one small shared stretch and return
   to round.

The last gesture deliberately reaches all the way back to experiment 01. A
motion that began as a question about one object's material recovery is now
being tested as punctuation between two bodies.


## 13 · a shape becomes a signal

12 suggests the grammar can carry a short sentence. The next thing I want to
know is whether one character can deliberately reuse a piece of that grammar.

Teach one association twice:

**left gets squeezed -> after release, right comes over.**

Then repeat the right body's visit a third time while changing only what came
before it:

- **REAL** — the press truly squeezes the left body;
- **SELF** — the press stays open and the left body makes the squeezed shape by
  itself;
- **NONE** — the press stays open and the left body remains round.

RIGHT's response is identical in all three lanes.

The interesting comparison is SELF vs NONE. If SELF gives the later visit a
sense of cause while NONE makes the same visit feel arbitrary, then squash has
stopped being only an effect of pressure. The characters have learned enough
history for a body shape to function as a cue.

That is the first place where this might become communication without adding a
symbol system on top of the animation.


## 14 · first gag

13 is the first experiment where a deformation can plausibly stop being only
physics and start functioning as a cue. So use that immediately instead of
writing an explanation of it.

This pass is a tiny causal joke:

1. twice, yellow is genuinely squeezed;
2. twice, cyan comes over after release;
3. yellow then makes the same squeezed shape with the press wide open;
4. cyan comes over again;
5. yellow keeps moving left, and cyan follows all the way into the old pressure
   station;
6. the press closes on cyan;
7. after release, yellow gives one tiny vertical stretch.

The stretch is a callback to experiment 01. I am not labeling it "smug" in the
animation; the test is whether history can make that read available.

This is also the first place where the two bodies begin to acquire asymmetric
roles from behavior rather than design: one exploits the learned rule; one
honors it.


## 15 · the same trick, once too often

14 is the first thing in the lab that behaves like a gag rather than a diagram.
So the next question is the most cartoonish one available: **what happens if
yellow tries it again?**

Replay the essential trap once. Cyan follows all the way into the station and
gets squeezed.

Reset.

Yellow performs the same counterfeit squash. Cyan starts the familiar visit but
stops just short. Yellow commits to the same leftward exit anyway. The press
closes on empty space.

Then cyan performs the tiny vertical stretch that yellow used as punctuation
after the first trap.

No new primitive is involved. The experiment is entirely about whether history
can make an incomplete movement — stopping before the expected destination —
read as knowledge, and whether borrowing somebody else's gesture can feel like
a reply.

This is the first moment where their asymmetry begins to feel reciprocal rather
than fixed: the one who got fooled can change the game.


## 16 · teach the trick back

15 shows that cyan can stop short of a repeated trap. The more interesting
possibility is that learning does not have to remain defensive.

Give them two symmetric pressure stations.

Yellow performs the fake-squash / follow-me / exit / squeeze routine on cyan.
Reset the board.

Then cyan performs the exact same procedure in mirror image at the other
station, and yellow follows it all the way in.

The second half introduces no new action. Its meaning should come from
**recognition**: the audience has already learned the procedure once and now
sees the other character reproduce it.

After yellow gets squeezed, cyan borrows the same tiny vertical punctuation
yellow used after the first trap.

If this reads, imitation itself is becoming a character action. They are no
longer just reacting to events; they can copy one another's strategies.
