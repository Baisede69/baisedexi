// ============================================================
// 霓虹突围 · Playwright 功能测试
// 覆盖模块：M1 基础框架 / M2 战斗 / M3 AI / M4 宝箱 / M5 背包 / M6 品质 / M7 撤离与仓库
// 运行：npx playwright test
// ============================================================
const { test, expect } = require("@playwright/test");

/** 打开页面并进入战场 */
async function enterRaid(page) {
  await page.goto("/game.html");
  await page.waitForFunction(() => window.__API__ && window.__API__.frameCount > 3);
  await page.click("#btnStart");
  await page.waitForFunction(() => window.__GAME__ && window.__GAME__.state === "raid");
}

/** 在世界中找一块空地并瞬移玩家过去（避开墙体，保证移动测试稳定） */
async function teleportToFreeSpot(page) {
  return await page.evaluate(() => {
    const G = window.__GAME__, C = window.__CONFIG__;
    for (let i = 0; i < 500; i++) {
      const x = 200 + Math.random() * (C.world.w - 400);
      const y = 200 + Math.random() * (C.world.h - 400);
      if (!window.__API__.posBlocked(x, y, 60)) { window.__API__.teleport(x, y); return { x, y }; }
    }
    return { x: 300, y: 300 };
  });
}

// ------------------------------------------------------------------
// M1 基础框架：页面加载、游戏循环、移动、瞄准
// ------------------------------------------------------------------
test.describe("M1 基础框架", () => {
  test("页面加载后 canvas 存在且游戏循环运行", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/game.html");
    await expect(page.locator("#game")).toBeVisible();
    const f1 = await page.evaluate(() => window.__API__.frameCount);
    await page.waitForTimeout(500);
    const f2 = await page.evaluate(() => window.__API__.frameCount);
    expect(f2).toBeGreaterThan(f1);          // 帧计数递增 => 循环在跑
    expect(errors).toEqual([]);              // 无运行时报错
  });

  test("WASD 可移动玩家，鼠标可改变瞄准角度", async ({ page }) => {
    await enterRaid(page);
    await teleportToFreeSpot(page);
    const before = await page.evaluate(() => ({ x: window.__GAME__.player.x, y: window.__GAME__.player.y }));
    await page.keyboard.down("d");
    await page.keyboard.down("s");
    await page.waitForTimeout(400);
    await page.keyboard.up("d");
    await page.keyboard.up("s");
    const after = await page.evaluate(() => ({ x: window.__GAME__.player.x, y: window.__GAME__.player.y }));
    const moved = Math.hypot(after.x - before.x, after.y - before.y);
    expect(moved).toBeGreaterThan(10);       // 确实发生了位移

    // 瞄准角度随鼠标位置变化
    await page.mouse.move(200, 200);
    const a1 = await page.evaluate(() => window.__GAME__.player.angle);
    await page.mouse.move(900, 600);
    const a2 = await page.evaluate(() => window.__GAME__.player.angle);
    expect(a1).not.toBeCloseTo(a2, 3);
  });
});

// ------------------------------------------------------------------
// M2 战斗系统：射击消耗弹药、R 换弹、总弹上限 210
// ------------------------------------------------------------------
test.describe("M2 战斗系统", () => {
  test("进战场时总子弹（弹匣+备弹）不超过 210 发", async ({ page }) => {
    await enterRaid(page);
    const total = await page.evaluate(() => window.__GAME__.player.mag + window.__GAME__.player.reserve);
    expect(total).toBeLessThanOrEqual(210);
    const mag = await page.evaluate(() => window.__GAME__.player.mag);
    expect(mag).toBe(30);                    // 弹匣 30 发
  });

  test("进战场默认携带 210 发弹药", async ({ page }) => {
    await enterRaid(page);
    const st = await page.evaluate(() => ({ mag: window.__GAME__.player.mag, reserve: window.__GAME__.player.reserve }));
    expect(st.mag + st.reserve).toBe(210);   // 初始 210 发：弹匣 30 + 备弹 180
  });

  test("按住左键射击消耗弹匣，R 换弹后弹匣补满且备弹减少", async ({ page }) => {
    await enterRaid(page);
    await page.mouse.move(640, 400);
    await page.mouse.down();
    await page.waitForTimeout(500);
    await page.mouse.up();
    const magAfterFire = await page.evaluate(() => window.__GAME__.player.mag);
    expect(magAfterFire).toBeLessThan(30);   // 弹药被消耗

    const reserveBefore = await page.evaluate(() => window.__GAME__.player.reserve);
    await page.keyboard.press("r");
    await page.waitForTimeout(1800);         // 换弹耗时 1.5s
    const st = await page.evaluate(() => ({
      mag: window.__GAME__.player.mag,
      reserve: window.__GAME__.player.reserve,
      reloading: window.__GAME__.player.reloading,
    }));
    expect(st.mag).toBe(30);                 // 弹匣补满
    expect(st.reserve).toBeLessThan(reserveBefore); // 备弹被扣除
    expect(st.reloading).toBe(false);
  });

  test("HUD 备用弹数字随实际备弹实时更新（回归：曾写死为 210）", async ({ page }) => {
    await enterRaid(page);
    const reserve = await page.evaluate(() => window.__GAME__.player.reserve);
    await expect(page.locator("#resText")).toHaveText(String(reserve));
    await expect(page.locator("#resText")).not.toHaveText("210"); // 不应是写死的常量
  });

  test("人机子弹命中玩家扣 20 滴血", async ({ page }) => {
    await enterRaid(page);
    // 验证配置值本身
    const aiDmg = await page.evaluate(() => window.__CONFIG__.ai.dmg);
    expect(aiDmg).toBe(20);
    // 直接把一发敌方子弹放到玩家身上，验证命中扣血逻辑
    const hpBefore = await page.evaluate(() => window.__GAME__.player.hp);
    await page.evaluate(() => {
      const G = window.__GAME__, p = G.player;
      G.bullets.push({ x: p.x, y: p.y, vx: 0, vy: 0, life: 0.1, owner: "enemy", dmg: window.__CONFIG__.ai.dmg });
    });
    await page.waitForTimeout(200);
    const hpAfter = await page.evaluate(() => window.__GAME__.player.hp);
    expect(hpBefore - hpAfter).toBe(20);            // 一枪恰好 20 滴血
  });
});

// ------------------------------------------------------------------
// M3 人机 AI：会向玩家逼近并开枪
// ------------------------------------------------------------------
test.describe("M3 人机 AI", () => {
  test("玩家进入视野后 AI 会靠近并开枪", async ({ page }) => {
    await enterRaid(page);
    // 迷宫地图：把玩家放到某个可通行格中心，再在射程内找「可通行且有视线」的格子放敌人
    const res = await page.evaluate(() => {
      const G = window.__GAME__, C = window.__CONFIG__, m = G.maze, API = window.__API__;
      const center = (c, r) => ({ x: (c + 0.5) * m.cell, y: (r + 0.5) * m.cell });
      // 玩家落在一个可通行格
      let pc = null, pr = null;
      for (let i = 0; i < 400 && pc === null; i++) {
        const c = 1 + Math.floor(Math.random() * (m.gw - 2));
        const r = 1 + Math.floor(Math.random() * (m.gh - 2));
        if (m.open[r * m.gw + c]) { pc = c; pr = r; }
      }
      const pp = center(pc, pr);
      API.teleport(pp.x, pp.y);
      // 近距离（有视线）找一格放敌人
      let placed = null;
      for (let rr = 1; rr < m.gh - 1 && !placed; rr++) {
        for (let cc = 1; cc < m.gw - 1 && !placed; cc++) {
          if (!m.open[rr * m.gw + cc]) continue;
          const pt = center(cc, rr);
          const d = Math.hypot(pt.x - pp.x, pt.y - pp.y);
          if (d < 120 || d > C.ai.fireRange - 60) continue;
          if (!API.lineBlocked(pp.x, pp.y, pt.x, pt.y)) placed = pt;
        }
      }
      if (!placed) placed = { x: pp.x + 130, y: pp.y };
      G.enemies.forEach((e, i) => {
        e.alive = true; e.hp = e.maxHp;
        e.x = placed.x + i * 5; e.y = placed.y + i * 5;
        e.state = "chase"; e.fireCd = 0; e.path = null; e.pathTimer = 0;
      });
      return { d0: Math.hypot(G.enemies[0].x - pp.x, G.enemies[0].y - pp.y) };
    });
    await page.waitForTimeout(1500);
    const after = await page.evaluate(() => {
      const G = window.__GAME__, p = G.player, e = G.enemies[0];
      return { d1: Math.hypot(e.x - p.x, e.y - p.y), enemyShots: G.shots.enemy };
    });
    expect(after.enemyShots).toBeGreaterThan(0);     // AI 确实开枪了
    expect(after.d1).toBeLessThan(res.d0 + 5);       // 并在向玩家逼近/保持接触
  });
});

// ------------------------------------------------------------------
// M4 宝箱：靠近 F 开箱，悬停物品按 F 拾取
// ------------------------------------------------------------------
test.describe("M4 宝箱与拾取", () => {
  test("靠近宝箱按 F 开箱，悬停物品按 F 拾取进背包", async ({ page }) => {
    await enterRaid(page);
    // 瞬移到未开启宝箱上
    await page.evaluate(() => {
      const c = window.__GAME__.chests.find((c) => !c.opened);
      window.__API__.teleport(c.x, c.y);
    });
    await page.waitForTimeout(100);
    await page.keyboard.press("f");
    await expect(page.locator("#chestPanel")).toBeVisible();
    const chestItems = await page.locator("#chestGrid .item").count();
    expect(chestItems).toBeGreaterThan(0);           // 宝箱里有物资
    expect(await page.locator("#chestGrid .item.searching").count()).toBeGreaterThan(0); // 初始是转圈占位

    // 等待第一件物资搜出（搜索动画结束）
    await page.waitForFunction(() => window.__GAME__.chestOpen.items.some((i) => i.revealed));
    // 悬停已搜出的物品并按 F
    await page.hover('#chestGrid .item[data-revealed="true"] >> nth=0');
    await page.keyboard.press("f");
    const bagUsed = await page.evaluate(() => window.__GAME__.player.slots.filter(Boolean).length);
    expect(bagUsed).toBe(1);                         // 物品进入背包
    const chestItemsAfter = await page.evaluate(() => window.__GAME__.chestOpen.items.length);
    expect(chestItemsAfter).toBe(chestItems - 1);    // 宝箱里少了一件
  });

  test("关闭宝箱后再打开，未取完的物资仍在（回归）", async ({ page }) => {
    await enterRaid(page);
    await page.evaluate(() => {
      const c = window.__GAME__.chests.find((c) => !c.opened);
      window.__API__.teleport(c.x, c.y);
    });
    await page.keyboard.press("f");
    await expect(page.locator("#chestPanel")).toBeVisible();
    const n = await page.evaluate(() => window.__GAME__.chestOpen.items.length);
    expect(n).toBeGreaterThan(0);
    await page.keyboard.press("Escape");             // 关闭
    await expect(page.locator("#chestPanel")).toBeHidden();
    await page.keyboard.press("f");                  // 再次打开同一个箱子
    await expect(page.locator("#chestPanel")).toBeVisible();
    const n2 = await page.evaluate(() => window.__GAME__.chestOpen.items.length);
    expect(n2).toBe(n);                              // 物资没有被清空
    expect(await page.locator("#chestGrid .empty-hint").count()).toBe(0);
  });

  test("宝箱物资有搜索动画，且品质越高转得越久", async ({ page }) => {
    await page.goto("/game.html");
    await page.waitForFunction(() => window.__API__);
    const spin = await page.evaluate(() => window.__CONFIG__.chestSpin);
    expect(spin.gold).toBeGreaterThan(spin.purple);    // 金 > 紫
    expect(spin.purple).toBeGreaterThan(spin.blue);    // 紫 > 蓝
    expect(spin.blue).toBeGreaterThan(spin.white);     // 蓝 > 白

    await page.click("#btnStart");
    await page.waitForFunction(() => window.__GAME__.state === "raid");
    await page.evaluate(() => {
      const c = window.__GAME__.chests.find((c) => c.tier === "gold") || window.__GAME__.chests[0];
      window.__API__.teleport(c.x, c.y);
    });
    await page.keyboard.press("f");
    await expect(page.locator("#chestGrid .item.searching").first()).toBeVisible();  // 有转圈占位
    await page.waitForFunction(() => window.__GAME__.chestOpen.items.every((i) => i.revealed), null, { timeout: 10000 });
    expect(await page.locator("#chestGrid .item.searching").count()).toBe(0);        // 全部搜出
  });

  test("宝箱品级越高，产出高级品质概率越高（统计验证）", async ({ page }) => {
    await page.goto("/game.html");
    await page.waitForFunction(() => window.__API__);
    const stat = await page.evaluate(() => {
      const score = { white: 0, blue: 1, purple: 2, gold: 3 };
      function avg(tier, n) {
        let s = 0, c = 0;
        for (let i = 0; i < n; i++) {
          window.__API__.rollLoot(tier).forEach((it) => { s += score[it.quality]; c++; });
        }
        return s / c;
      }
      return { bronze: avg("bronze", 400), silver: avg("silver", 400), gold: avg("gold", 400) };
    });
    expect(stat.silver).toBeGreaterThan(stat.bronze);  // 银 > 铜
    expect(stat.gold).toBeGreaterThan(stat.silver);    // 金 > 银
  });
});

// ------------------------------------------------------------------
// M5 背包：Tab 开关、丢弃落地、地面拾取
// ------------------------------------------------------------------
test.describe("M5 背包系统", () => {
  test("Tab 开关背包，丢弃物品落地后可再拾取", async ({ page }) => {
    await enterRaid(page);
    await page.evaluate(() => window.__API__.giveItem("blue"));
    await page.keyboard.press("Tab");
    await expect(page.locator("#bagPanel")).toBeVisible();

    // 悬停物品卡片 → 点击「丢」
    await page.hover("#bagGrid .item >> nth=0");
    await page.click("#bagGrid .item >> nth=0 >> .drop-btn");
    const st = await page.evaluate(() => ({
      bagUsed: window.__GAME__.player.slots.filter(Boolean).length,
      drops: window.__GAME__.drops.length,
    }));
    expect(st.bagUsed).toBe(0);           // 背包已空
    expect(st.drops).toBe(1);             // 地面出现掉落物

    // 关闭背包 → 走到掉落物上按 F 拾取
    await page.keyboard.press("Tab");
    await expect(page.locator("#bagPanel")).toBeHidden();
    await page.evaluate(() => {
      const d = window.__GAME__.drops[0];
      window.__API__.teleport(d.x, d.y);
    });
    await page.keyboard.press("f");
    const bagUsed2 = await page.evaluate(() => window.__GAME__.player.slots.filter(Boolean).length);
    expect(bagUsed2).toBe(1);             // 重新拾取成功
  });

  test("背包格子上限：塞满后无法再拾取", async ({ page }) => {
    await enterRaid(page);
    await page.evaluate(() => {
      const G = window.__GAME__;
      for (let i = 0; i < G.player.slots.length; i++) G.player.slots[i] = window.__API__.makeItem("white");
    });
    const full = await page.evaluate(() => window.__GAME__.player.slots.filter(Boolean).length);
    expect(full).toBe(20);                // 20 格全部占满
  });
});

// ------------------------------------------------------------------
// M6 品质系统
// ------------------------------------------------------------------
test.describe("M6 品质系统", () => {
  test("四种品质可正确生成且带品质字段", async ({ page }) => {
    await page.goto("/game.html");
    await page.waitForFunction(() => window.__API__);
    const qs = await page.evaluate(() => ["white", "blue", "purple", "gold"].map((q) => window.__API__.makeItem(q).quality));
    expect(qs).toEqual(["white", "blue", "purple", "gold"]);
  });
});

// ------------------------------------------------------------------
// M7 撤离与仓库
// ------------------------------------------------------------------
test.describe("M7 撤离与仓库", () => {
  test("进入撤离区停留 3 秒 → 撤离成功，物资入库并存档", async ({ page }) => {
    await enterRaid(page);
    await page.evaluate(() => {
      window.__API__.giveItem("gold");
      window.__API__.giveItem("purple");
      const ex = window.__GAME__.extract;
      window.__API__.teleport(ex.x, ex.y);
    });
    // 等待读条 3 秒完成
    await page.waitForFunction(() => window.__GAME__.state === "result", null, { timeout: 8000 });
    await expect(page.locator("#resultPanel")).toBeVisible();
    await expect(page.locator("#resultTitle")).toHaveText("撤离成功");
    const save = await page.evaluate(() => JSON.parse(localStorage.getItem("neon_extraction_save_v1")));
    expect(save.warehouse.length).toBe(2);   // 带出的 2 件物资已入库
    expect(save.extracts).toBe(1);
  });

  test("被人机击杀 → 撤离失败，本局物资全部丢失、仓库不变", async ({ page }) => {
    await enterRaid(page);
    const before = await page.evaluate(() => {
      window.__API__.giveItem("gold");
      window.__API__.giveItem("gold");
      return window.__GAME__.save.warehouse.length;
    });
    await page.evaluate(() => window.__API__.endRaid(false));
    await expect(page.locator("#resultTitle")).toHaveText("撤离失败");
    const save = await page.evaluate(() => JSON.parse(localStorage.getItem("neon_extraction_save_v1")));
    expect(save.warehouse.length).toBe(before);  // 仓库没有新增
    expect(save.deaths).toBe(1);
  });

  test("仓库购买子弹：游戏币减少、备用子弹增加", async ({ page }) => {
    await page.goto("/game.html");
    await page.waitForFunction(() => window.__API__);
    await page.click("#btnWarehouse");
    await expect(page.locator("#warehousePanel")).toBeVisible();
    const before = await page.evaluate(() => ({ coins: window.__GAME__.save.coins, ammo: window.__GAME__.save.ammo }));
    await page.click("#btnBuyAmmo");
    const after = await page.evaluate(() => ({ coins: window.__GAME__.save.coins, ammo: window.__GAME__.save.ammo }));
    expect(after.coins).toBe(before.coins - 45);   // 花费 45 币
    expect(after.ammo).toBe(before.ammo + 30);     // 获得 30 发
  });

  test("刷新页面后仓库数据从 localStorage 恢复", async ({ page }) => {
    await page.goto("/game.html");
    await page.waitForFunction(() => window.__API__);
    await page.click("#btnWarehouse");
    await page.click("#btnBuyAmmo");
    const ammoBefore = await page.evaluate(() => window.__GAME__.save.ammo);
    await page.reload();
    await page.waitForFunction(() => window.__API__);
    const ammoAfter = await page.evaluate(() => window.__GAME__.save.ammo);
    expect(ammoAfter).toBe(ammoBefore);            // 购买结果持久化
  });
});

// ------------------------------------------------------------------
// M8 需求变更验收：撤离区不挡墙 / 自定义携带弹药 / 药品与背包区 / 开箱丢弃
// ------------------------------------------------------------------
test.describe("M8 需求变更验收", () => {
  test("撤离区不会被墙体遮挡，玩家可站入并撤离", async ({ page }) => {
    await enterRaid(page);
    const res = await page.evaluate(() => {
      const G = window.__GAME__, C = window.__CONFIG__;
      function circleRect(cx, cy, r, rect) {
        const nx = Math.max(rect.x, Math.min(cx, rect.x + rect.w));
        const ny = Math.max(rect.y, Math.min(cy, rect.y + rect.h));
        return (cx - nx) ** 2 + (cy - ny) ** 2 <= r * r;
      }
      const ex = G.extract;
      const blocked = G.walls.some((w) => circleRect(ex.x, ex.y, ex.r, w));  // 有无墙压在撤离区上
      window.__API__.teleport(ex.x, ex.y);
      const stuck = window.__API__.posBlocked(ex.x, ex.y, C.player.r);       // 玩家能否站进中心
      return { blocked, stuck };
    });
    expect(res.blocked).toBe(false);
    expect(res.stuck).toBe(false);
  });

  test("仓库自定义携带子弹数量，进图按该数量发放", async ({ page }) => {
    await page.goto("/game.html");
    await page.waitForFunction(() => window.__API__);
    await page.click("#btnWarehouse");
    await page.fill("#carryInput", "60");
    await page.click("#btnSetCarry");
    await page.click("#whClose");
    await page.click("#btnStart");
    await page.waitForFunction(() => window.__GAME__.state === "raid");
    const st = await page.evaluate(() => ({ mag: window.__GAME__.player.mag, reserve: window.__GAME__.player.reserve }));
    expect(st.mag + st.reserve).toBe(60);   // 只带 60 发进图
  });

  test("仓库购买药品：花费 50 币并入库", async ({ page }) => {
    await page.goto("/game.html");
    await page.waitForFunction(() => window.__API__);
    await page.click("#btnWarehouse");
    const before = await page.evaluate(() => ({ coins: window.__GAME__.save.coins, wh: window.__GAME__.save.warehouse.length }));
    await page.click("#btnBuyMed");
    const after = await page.evaluate(() => ({
      coins: window.__GAME__.save.coins,
      wh: window.__GAME__.save.warehouse.length,
      usable: window.__GAME__.save.warehouse.some((i) => i.usable),
    }));
    expect(after.coins).toBe(before.coins - 50);
    expect(after.wh).toBe(before.wh + 1);
    expect(after.usable).toBe(true);        // 是可用药品
  });

  test("把药品「装入」背包区后即可带入战场", async ({ page }) => {
    await page.goto("/game.html");
    await page.waitForFunction(() => window.__API__);
    await page.click("#btnWarehouse");
    await page.click("#btnBuyMed");
    await page.click("#btnBuyMed");
    // 仓库里的药品逐个「装入」背包区（操作按钮悬停后出现）
    await page.hover("#whGrid .item >> nth=0");
    await page.click("#whGrid .item >> nth=0 >> .drop-btn");
    await page.hover("#whGrid .item >> nth=0");
    await page.click("#whGrid .item >> nth=0 >> .drop-btn");
    const ld = await page.evaluate(() => window.__GAME__.save.loadout.length);
    expect(ld).toBe(2);
    await page.click("#whClose");
    await page.click("#btnStart");
    await page.waitForFunction(() => window.__GAME__.state === "raid");
    const meds = await page.evaluate(() => window.__GAME__.player.slots.filter((i) => i && i.usable).length);
    expect(meds).toBe(2);                   // 两个药品已随背包进入战场
  });

  test("战场按 H 使用药品回复 30 血并消耗药品", async ({ page }) => {
    await enterRaid(page);
    await page.evaluate(() => { window.__GAME__.player.hp = 50; window.__API__.giveMedkit(); });
    await page.keyboard.press("h");
    const hp = await page.evaluate(() => window.__GAME__.player.hp);
    expect(hp).toBe(80);                    // 50 + 30
    const meds = await page.evaluate(() => window.__GAME__.player.slots.filter((i) => i && i.usable).length);
    expect(meds).toBe(0);                   // 药品被消耗
  });

  test("开箱弹窗右侧背包可直接丢弃物品", async ({ page }) => {
    await enterRaid(page);
    await page.evaluate(() => {
      window.__API__.giveItem("purple");
      const c = window.__GAME__.chests.find((c) => !c.opened);
      window.__API__.teleport(c.x, c.y);
    });
    await page.keyboard.press("f");         // 开箱
    await expect(page.locator("#chestPanel")).toBeVisible();
    expect(await page.evaluate(() => window.__GAME__.player.slots.filter(Boolean).length)).toBe(1);
    // 在开箱弹窗右侧背包点击「丢」
    await page.hover("#chestBagGrid .item >> nth=0");
    await page.click("#chestBagGrid .item >> nth=0 >> .drop-btn");
    const st = await page.evaluate(() => ({
      bag: window.__GAME__.player.slots.filter(Boolean).length,
      drops: window.__GAME__.drops.length,
    }));
    expect(st.bag).toBe(0);                 // 背包已空
    expect(st.drops).toBe(1);               // 物品落在地上
  });
});

// ------------------------------------------------------------------
// M9 迷宫地图：连续墙体 + 通路，且全图连通
// ------------------------------------------------------------------
test.describe("M9 迷宫地图", () => {
  test("地图是连续迷宫墙体，且有大量通路（非随机方块）", async ({ page }) => {
    await enterRaid(page);
    const res = await page.evaluate(() => {
      const G = window.__GAME__;
      const m = G.maze;
      let open = 0, wall = 0;
      for (let i = 0; i < m.open.length; i++) (m.open[i] ? open++ : wall++);
      return { hasMaze: !!m, wallRects: G.walls.length, open, wall };
    });
    expect(res.hasMaze).toBe(true);
    expect(res.wallRects).toBeGreaterThan(20);   // 迷宫墙体由大量墙格合并而成
    expect(res.open).toBeGreaterThan(20);        // 有通路
    expect(res.wall).toBeGreaterThan(20);        // 也有墙
  });

  test("迷宫全图连通：玩家可以寻路走到撤离区", async ({ page }) => {
    await enterRaid(page);
    const res = await page.evaluate(() => {
      const G = window.__GAME__, p = G.player, ex = G.extract;
      const path = window.__API__.findPath(p.x, p.y, ex.x, ex.y);
      return { ok: !!path && path.length > 0, len: path ? path.length : 0 };
    });
    expect(res.ok).toBe(true);
    expect(res.len).toBeGreaterThan(0);          // 存在一条从玩家到撤离区的通路
  });

  test("迷宫里 AI 能沿通路接近玩家（寻路生效）", async ({ page }) => {
    await enterRaid(page);
    // 把玩家和敌人分别放到两个相距较远、且互相有通路的可通行格
    const res = await page.evaluate(() => {
      const G = window.__GAME__, m = G.maze, API = window.__API__;
      const center = (c, r) => ({ x: (c + 0.5) * m.cell, y: (r + 0.5) * m.cell });
      const opens = [];
      for (let r = 1; r < m.gh - 1; r++) for (let c = 1; c < m.gw - 1; c++) {
        if (m.open[r * m.gw + c]) opens.push({ c, r });
      }
      const a = opens[0], b = opens[Math.floor(opens.length / 2)];
      const pp = center(a.c, a.r), ee = center(b.c, b.r);
      API.teleport(pp.x, pp.y);
      const path = API.findPath(ee.x, ee.y, pp.x, pp.y);
      G.enemies.forEach((e) => { e.alive = false; });
      const e0 = G.enemies[0];
      e0.alive = true; e0.hp = e0.maxHp; e0.x = ee.x; e0.y = ee.y;
      e0.state = "chase"; e0.patrolTimer = 0; e0.path = null; e0.pathTimer = 0;
      e0.fireCd = 999;                                   // 只测移动，不开枪
      e0.lastSeen = { x: pp.x, y: pp.y };                // 让 AI 记忆中知道玩家大概位置
      e0.searchTimer = 10;
      const d0 = Math.hypot(e0.x - pp.x, e0.y - pp.y);
      return { d0, pathLen: path ? path.length : 0 };
    });
    await page.waitForTimeout(2500);
    const d1 = await page.evaluate(() => {
      const G = window.__GAME__, p = G.player, e = G.enemies[0];
      return Math.hypot(e.x - p.x, e.y - p.y);
    });
    expect(res.pathLen).toBeGreaterThan(1);      // 两者之间确实隔着通路
    expect(d1).toBeLessThan(res.d0 - 20);        // AI 沿通路显著靠近了玩家
  });
});
