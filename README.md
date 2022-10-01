LD51 - Every 10 Seconds
============================

Ludum Dare 51 Entry by Jimbly - "Name TBD"

* Play here: [dashingstrike.com/LudumDare/LD51/](http://www.dashingstrike.com/LudumDare/LD51/)
* Using [Javascript libGlov/GLOV.js framework](https://github.com/Jimbly/glovjs)

Start with: `npm start` (after running `npm i` once)


The 10 Second Space Game
X Field of asteroids
X First unit: minor miner
X Select miner, place on map, builds instantly, minerals start coming in, asteroids get depleted
  X miners change color
  X miners show dig arrow sprite too
* Next: simulation functionality:
  X Second unit: Factory, generates supplies
    X Supplies are stored up to some partial capacity (so building can start immediately, if there was any left)
  X Building takes supplies
  * Mining takes supplies
  * Supply links have an active state
  * Supplies travel on links
  * Rules:
    * Units that are building: grab a packet whenever one is available and none are in flight
    * On 10 second tick:
      * Send one packet to each building unit that does not have one in flight (will only happen if we were out of supply)
      * Initially figure out how many packets each unit needs to get to max, send round robin to those
  * Do not allow supply links overlapping nodes, or nodes placed over links
    * supply links maybe don't get stored per-ent?
  * Probably: can select ents and see their status: current+max supply, value left on asteroids, etc
  * Build graph nodes
* Progress
  * Show progress to completing the whole level, show time elapsed
* Next unit: other supply generator (cheap, cannot be tightly packed)?
* Then: waves of enemies?  Is this fun already, how much time is left? =)
* Unit ideas:
  * Major miner
  * Weapons Storage / Build Storage (just stores supplies only to be released for weapons/building)
  * Laser/MG
  * Missile
  * Cannon
  * Repair
* Alternative skin: Dwarves
  * Supply is dwarves, dwarves get sent to work the mines, man the forts, etc

Original brainstorming:
* 10 Second RTS
  * Lane based, ~5 lanes for your troops to be in
  * Controls are moving your troops between lanes
  * The constantly charge forward/attack
  * Troop types: infantry, archers, cavalry, general
  * Flanking, bonuses, etc
  * Between battles, re-buy troops, upgrades, etc, world map?
* The Space Game with 10 second pacing
  * Probably: energy production is once every 10 seconds, energy is distributed round-robin up to the maximum capacity of each thing, miners take 1 energy every 10 seconds, so should usually fully operate, lasers maybe 10, so may operate half the time, or accumulate 1 energy each 10s and spend it in a burst
    * Maybe even want to be able to control how much energy each thing gets, so you can intentionally have slow-charging lasers?  No, too complex, and just letting them quickly charge to max should let other things get more energy next tick
    * Battery nodes (only distribute power farther down the tree)
  * New enemies spawn each 10s
  * Currencies: Minerals and Energy
    * Energy traverses the tree visibly, minerals is just on-screen number
    * Building something takes energy? maybe? or, a builder node, can hold 10 energy to hold 10 build units, and building takes one of those (but can be done at a rate higher than once every 10s, unless exhausted)
      * Ideally minerals consumed only when (a portion of) the building is built (or, consumed immediately, but refunded if the building is destroyed before being finished?  maybe not, who cares?)
  * Pacing of enemy wave taking ~30s to arrive is probably ideal
  * Goal like The Space Game: mine all of the minerals and survive in minimal time
