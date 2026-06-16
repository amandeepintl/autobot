# Autobot

A production-grade, highly resilient, stationary AFK Mineflayer service designed for 24/7 uptime on Minecraft servers (specifically optimized for Aternos). 

## Key Architecture

Autobot uses a decoupled, multi-phase parent-child architecture designed for ultra-low resource footprint and maximum resilience.

```mermaid
graph TD
    subgraph Parent Process
        S[Supervisor - src/supervisor.js]
    end
    subgraph Child Process
        I[Index - src/index.js]
        EB[Event Bus - src/eventBus.js]
        TS[Task Scheduler - src/taskScheduler.js]
        C[Connection Manager - src/connection.js]
        CB[Circuit Breaker - src/circuitBreaker.js]
        W[Watchdog - src/watchdog.js]
        H[Health Monitor - src/healthMonitor.js]
        NM[Network Monitor - src/networkMonitor.js]
        SD[Server Detection - src/serverDetection.js]
        CL[Cleanup - src/cleanup.js]
        B[Behavior Manager - src/behavior.js]
        AFK[Anti-AFK - src/antiAfk.js]
        MM[Micro-Movement - src/microMovement.js]
        UN[Unstuck - src/unstuck.js]
        SM[Sleep Manager - src/sleepManager.js]
        WM[World Memory - src/worldMemory.js]
        UR[Username Rotation - src/usernameRotation.js]
        L[Logger - src/logger.js]
        DEP[Deployment - src/deployment.js]
        DI[Diagnostics - src/diagnostics.js]
        SMG[Storage Manager - src/storageManager.js]
        BM[Backup Manager - src/backupManager.js]
        M[Metrics - src/metrics.js]
        ST[Status Reporter - src/statusReporter.js]
    end

    S -->|spawns/monitors| I
    I -->|heartbeats (every 60s)| S
    I --> EB
    I --> TS
```

## Features

- **Robust Multi-Phase Bootstrapping**: Six-phase startup sequence (Deployment -> Diagnostics -> Storage -> Connection -> Behavior -> Monitoring) with failure aborts.
- **Supervisor-Child Model**: The parent supervisor forks the child process with `--max-old-space-size=256 --expose-gc` and monitors heartbeat pings. If the child freezes or crashes, it is automatically respawned.
- **Hot-Reloading Configuration**: Automatically monitors `src/config.js` via MD5 hashing every 30 seconds and reloads settings live without breaking the connection.
- **Circuit Breaker Protection**: Dynamically pauses connection attempts for 30 minutes if 20 consecutive attempts fail.
- **Freeze Watchdog**: Monitors socket packet rates and physics tick timings, executing progressive soft/hard reconnects and restarts on freezes.
- **Micro-Movements & Unstuck Logic**: Custom localized steps and jumps (`src/microMovement.js`, `src/unstuck.js`) replace heavy pathfinding engines to maintain zero-idle-CPU footprints.
- **Player-Interactive Sleep Countdown**: Announce sleep plans, count down from 15 in chat, allow players to veto by typing `no`, and pause sleep for 5 minutes if vetoed.
- **Daily Logger & Rotation**: Writes logs to `logs/latest.log` with daily archival and a 30-day retention cleanup routine.
- **Atomic Database Management**: Safe writes using `.tmp` buffers and `.backup` rollbacks to prevent corruption.

## Installation & Setup

1. Clone this repository.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create a `.env` file in the root directory and specify your server credentials:
   ```env
   MC_SERVER_HOST="your-server-ip.aternos.me"
   MC_SERVER_PORT=12345
   MC_SERVER_VERSION="1.20.4"
   ```
4. Start the bot:
   ```bash
   npm start
   ```

## Configuration

All custom settings can be configured inside [src/config.js](src/config.js):
- **antiAfk**: Interval and actions (rotation, crouching, walking, slot swapping).
- **watchdog**: Packet, tick, and chat timeout thresholds.
- **usernameRotation**: Rotation sequences and account pools.
- **healthMonitor**: Memory limit RSS settings and lag thresholds.
- **behavior**: Chat paragraphs and message intervals.
