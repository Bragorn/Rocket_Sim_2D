/* =====================================================================
   FAKE PLANCK  (tests/fake-planck.js)
   A tiny stand-in for the physics engine, shared by the tests that run without a browser.
   It does no physics: bodies stay where they are. What it does keep track of is what the
   game's own code asks of a body: the shapes on it (several per body), its mass (the
   shapes' densities added up), its speed, the pushes and turns it was given, and the
   bodies the world holds. dynamicCount() is not a planck call: it is for the tests.
   ===================================================================== */
function Vec2(x, y) { this.x = x; this.y = y; }
function Polygon(verts) { this.verts = verts; }
function Circle(r) { this.r = r; }
function area(v) { let a = 0; for (let i = 0; i < v.length; i++) { const p = v[i], q = v[(i + 1) % v.length]; a += p.x * q.y - q.x * p.y; } return Math.abs(a) / 2; }

class Fixture {
  constructor(body, def) { this.body = body; this.shape = def.shape; this.density = def.density || 0; }
  setDensity(d) { this.density = d; }
  getDensity() { return this.density; }
  getBody() { return this.body; }
}

class Body {
  constructor(def) {
    this.type = def.type; this.pos = def.position; this.angle = def.angle || 0; this.fixtures = []; this.next = null;
    this.vel = new Vec2(0, 0); this.spin = 0; this.forceSum = 0; this.torque = 0;
  }
  createFixture(def) { const f = new Fixture(this, def); this.fixtures.push(f); return f; }
  destroyFixture(f) { const i = this.fixtures.indexOf(f); if (i >= 0) this.fixtures.splice(i, 1); }
  getFixtureList() { return this.fixtures[0] || null; }
  getMass() { return this.type === "dynamic" ? this.fixtures.reduce(function (m, f) { return m + f.density * area(f.shape.verts); }, 0) : 0; }
  resetMassData() {}
  isDynamic() { return this.type === "dynamic"; }
  getNext() { return this.next; }
  getPosition() { return this.pos; }
  getAngle() { return this.angle; }
  getWorldCenter() { return this.pos; }
  getWorldPoint(l) { return new Vec2(this.pos.x + l.x, this.pos.y + l.y); }
  getLinearVelocity() { return this.vel; }
  getLinearVelocityFromWorldPoint() { return new Vec2(this.vel.x, this.vel.y); }
  setLinearVelocity(v) { this.vel = new Vec2(v.x, v.y); }
  getAngularVelocity() { return this.spin; }
  setAngularVelocity(w) { this.spin = w; }
  applyForce(f) { this.forceSum += Math.hypot(f.x, f.y); }
  applyForceToCenter() {}
  applyTorque(t) { this.torque += t; }
  applyLinearImpulse(J) { const m = this.getMass(); this.vel = new Vec2(this.vel.x + J.x / m, this.vel.y + J.y / m); }
}

class World {
  constructor() { this.first = null; this.last = null; this.bodies = []; }
  createBody(def) { const b = new Body(def); if (this.last) this.last.next = b; else this.first = b; this.last = b; this.bodies.push(b); return b; }
  getBodyList() { return this.first; }
  dynamicCount() { return this.bodies.filter(function (b) { return b.type === "dynamic"; }).length; }
  on() {}
  step() {}
}

module.exports = { Settings: {}, Vec2, Polygon, Circle, World };
