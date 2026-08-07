/**
 * Lightweight runner shown only while human matchmaking is active.
 *
 * This is the adult-study adaptation of the SPACE-to-hop game in the `kids`
 * branch. Its state is deliberately isolated from trial state and scoring.
 */
export class WaitingMinigame {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onStats = typeof options.onStats === 'function' ? options.onStats : null;

    this.running = false;
    this.frameId = null;
    this.startTime = null;
    this.endTime = null;
    this.lastFrameTime = 0;
    this.nextObstacleIn = 500;
    this.collisionCooldownUntil = 0;
    this.jumpCount = 0;
    this.collisionCount = 0;

    this.width = 640;
    this.height = 240;
    this.groundY = 188;
    this.speed = 3.7;
    this.obstacles = [];
    this.sparkles = [];
    this.jumper = {
      x: 82,
      y: 136,
      width: 42,
      height: 48,
      vy: 0,
      onGround: true,
      bounce: 0
    };

    this.handleKeyDown = this.handleKeyDown.bind(this);
    this.handleResize = this.handleResize.bind(this);
    this.tick = this.tick.bind(this);
  }

  start() {
    if (this.running || !this.ctx) return this.getStats();

    this.running = true;
    this.startTime = Date.now();
    this.lastFrameTime = performance.now();
    this.resizeCanvas();
    window.addEventListener('keydown', this.handleKeyDown, true);
    window.addEventListener('resize', this.handleResize);
    this.frameId = window.requestAnimationFrame(this.tick);
    this.emitStats();
    return this.getStats();
  }

  stop() {
    if (!this.running) return this.getStats(true);

    this.running = false;
    this.endTime = Date.now();
    if (this.frameId) {
      window.cancelAnimationFrame(this.frameId);
      this.frameId = null;
    }
    window.removeEventListener('keydown', this.handleKeyDown, true);
    window.removeEventListener('resize', this.handleResize);
    this.emitStats();
    return this.getStats(true);
  }

  handleResize() {
    this.resizeCanvas();
  }

  resizeCanvas() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.width = Math.max(320, Math.round(rect.width || 640));
    this.height = Math.max(200, Math.round(rect.height || 240));
    this.groundY = this.height - 48;

    const nextWidth = Math.round(this.width * dpr);
    const nextHeight = Math.round(this.height * dpr);
    if (this.canvas.width !== nextWidth || this.canvas.height !== nextHeight) {
      this.canvas.width = nextWidth;
      this.canvas.height = nextHeight;
    }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this.jumper.onGround) {
      this.jumper.y = this.groundY - this.jumper.height;
    }
  }

  handleKeyDown(event) {
    const isSpace = event.code === 'Space' || event.key === ' ' || event.key === 'Spacebar';
    if (!isSpace) return;

    event.preventDefault();
    event.stopPropagation?.();
    if (!this.running || event.repeat || !this.jumper.onGround) return;

    this.jumper.vy = -11.8;
    this.jumper.onGround = false;
    this.jumper.bounce = 1;
    this.jumpCount += 1;
    this.emitStats();
  }

  tick(now) {
    if (!this.running) return;

    const delta = Math.min(48, Math.max(8, now - this.lastFrameTime));
    const step = delta / 16.67;
    this.lastFrameTime = now;
    this.update(step, delta, now);
    this.draw(now);
    this.frameId = window.requestAnimationFrame(this.tick);
  }

  update(step, delta, now) {
    const jumper = this.jumper;
    jumper.vy += 0.58 * step;
    jumper.y += jumper.vy * step;
    jumper.bounce = Math.max(0, jumper.bounce - 0.06 * step);

    const floorY = this.groundY - jumper.height;
    if (jumper.y >= floorY) {
      jumper.y = floorY;
      jumper.vy = 0;
      jumper.onGround = true;
    }

    const speed = this.speed * step;
    this.nextObstacleIn -= delta;
    if (this.nextObstacleIn <= 0) {
      this.spawnObstacle();
      this.nextObstacleIn = 950 + Math.random() * 750;
    }

    this.obstacles.forEach(obstacle => {
      obstacle.x -= speed;
      obstacle.wobble += 0.04 * step;
    });
    this.obstacles = this.obstacles.filter(obstacle => obstacle.x + obstacle.width > -40);

    this.sparkles.forEach(sparkle => {
      sparkle.x += sparkle.vx * step;
      sparkle.y += sparkle.vy * step;
      sparkle.life -= delta;
    });
    this.sparkles = this.sparkles.filter(sparkle => sparkle.life > 0);
    this.checkCollisions(now);
  }

  spawnObstacle() {
    const height = 28 + Math.random() * 18;
    const width = 20 + Math.random() * 18;
    this.obstacles.push({
      x: this.width + 24,
      y: this.groundY - height,
      width,
      height,
      color: Math.random() > 0.5 ? '#7c8cff' : '#4dabf7',
      accent: Math.random() > 0.5 ? '#c77dff' : '#1fb6a6',
      wobble: Math.random() * Math.PI
    });
  }

  checkCollisions(now) {
    if (now < this.collisionCooldownUntil) return;

    const jumperBox = {
      x: this.jumper.x + 8,
      y: this.jumper.y + 8,
      width: this.jumper.width - 14,
      height: this.jumper.height - 10
    };
    const hitIndex = this.obstacles.findIndex(obstacle => this.intersects(jumperBox, {
      x: obstacle.x + 3,
      y: obstacle.y + 3,
      width: obstacle.width - 6,
      height: obstacle.height - 3
    }));
    if (hitIndex === -1) return;

    const hit = this.obstacles[hitIndex];
    this.obstacles.splice(hitIndex, 1);
    this.collisionCooldownUntil = now + 650;
    this.collisionCount += 1;
    this.jumper.vy = -7.5;
    this.jumper.onGround = false;
    this.jumper.bounce = 1;
    this.addSparkles(hit.x + hit.width / 2, hit.y + hit.height / 2);
    this.emitStats();
  }

  intersects(a, b) {
    return a.x < b.x + b.width &&
      a.x + a.width > b.x &&
      a.y < b.y + b.height &&
      a.y + a.height > b.y;
  }

  addSparkles(x, y) {
    for (let index = 0; index < 9; index += 1) {
      const angle = (Math.PI * 2 * index) / 9;
      this.sparkles.push({
        x,
        y,
        vx: Math.cos(angle) * (1.8 + Math.random() * 1.4),
        vy: Math.sin(angle) * (1.8 + Math.random() * 1.4),
        size: 3 + Math.random() * 3,
        life: 420 + Math.random() * 260
      });
    }
  }

  draw(now) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);
    this.drawBackground(ctx, now);
    this.drawObstacles(ctx);
    this.drawJumper(ctx);
    this.drawSparkles(ctx);
  }

  drawBackground(ctx, now) {
    const sky = ctx.createLinearGradient(0, 0, 0, this.height);
    sky.addColorStop(0, '#eef7ff');
    sky.addColorStop(1, '#ffffff');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, this.width, this.height);

    const cloudOffset = (now / 80) % (this.width + 180);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
    this.drawCloud(ctx, this.width - cloudOffset, 46, 0.72);
    this.drawCloud(ctx, this.width - ((cloudOffset + 250) % (this.width + 180)), 78, 0.55);

    ctx.fillStyle = '#d9f2ec';
    ctx.fillRect(0, this.groundY + 2, this.width, this.height - this.groundY);
    ctx.strokeStyle = '#91d6c9';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(0, this.groundY + 2);
    ctx.lineTo(this.width, this.groundY + 2);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(80, 160, 180, 0.25)';
    ctx.lineWidth = 2;
    for (let x = -20; x < this.width + 20; x += 42) {
      const wave = Math.sin((now / 400) + x) * 2;
      ctx.beginPath();
      ctx.moveTo(x, this.groundY + 28 + wave);
      ctx.lineTo(x + 20, this.groundY + 24 - wave);
      ctx.stroke();
    }
  }

  drawCloud(ctx, x, y, scale) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.beginPath();
    ctx.arc(0, 12, 18, 0, Math.PI * 2);
    ctx.arc(24, 0, 24, 0, Math.PI * 2);
    ctx.arc(54, 12, 20, 0, Math.PI * 2);
    ctx.rect(0, 12, 54, 20);
    ctx.fill();
    ctx.restore();
  }

  drawObstacles(ctx) {
    this.obstacles.forEach(obstacle => {
      const wobble = Math.sin(obstacle.wobble) * 2;
      ctx.save();
      ctx.translate(obstacle.x + obstacle.width / 2, obstacle.y + obstacle.height / 2 + wobble);
      ctx.fillStyle = obstacle.color;
      ctx.strokeStyle = '#28536b';
      ctx.lineWidth = 2;
      this.roundRect(ctx, -obstacle.width / 2, -obstacle.height / 2, obstacle.width, obstacle.height, 7);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = obstacle.accent;
      ctx.beginPath();
      ctx.arc(0, -obstacle.height / 5, Math.max(4, obstacle.width / 5), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
  }

  drawJumper(ctx) {
    const jumper = this.jumper;
    const squash = jumper.onGround ? jumper.bounce * 4 : 0;
    ctx.save();
    ctx.translate(jumper.x + jumper.width / 2, jumper.y + jumper.height / 2 + squash / 2);
    ctx.scale(1 + squash / 80, 1 - squash / 80);
    ctx.translate(-jumper.width / 2, -jumper.height / 2);

    ctx.fillStyle = '#1fb6a6';
    ctx.strokeStyle = '#28536b';
    ctx.lineWidth = 3;
    this.roundRect(ctx, 6, 7, 31, 35, 10);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#7fded2';
    ctx.beginPath();
    ctx.moveTo(6, 22);
    ctx.lineTo(-10, 31);
    ctx.lineTo(8, 34);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#28536b';
    ctx.beginPath();
    ctx.arc(29, 18, 3.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#28536b';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(13, 41);
    ctx.lineTo(9, 49);
    ctx.moveTo(28, 41);
    ctx.lineTo(32, 49);
    ctx.stroke();
    ctx.restore();
  }

  drawSparkles(ctx) {
    ctx.fillStyle = '#ffdf6b';
    this.sparkles.forEach(sparkle => {
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, sparkle.life / 520));
      ctx.beginPath();
      ctx.arc(sparkle.x, sparkle.y, sparkle.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
  }

  roundRect(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + r);
    ctx.lineTo(x + width, y + height - r);
    ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    ctx.lineTo(x + r, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  emitStats() {
    this.onStats?.(this.getStats());
  }

  getStats(finalize = false) {
    const endTime = this.endTime || (finalize ? Date.now() : null);
    return {
      enabled: true,
      startTime: this.startTime,
      endTime,
      durationMs: this.startTime && endTime ? endTime - this.startTime : null,
      jumpCount: this.jumpCount,
      collisionCount: this.collisionCount
    };
  }
}
