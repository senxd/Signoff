import { createClient, type RedisClientType } from "redis";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CompletionContract, JobEvent } from "../contracts";
import { env } from "../config/env";

export interface JobStore {
  saveJob(job: CompletionContract): Promise<void>;
  getJob(id: string): Promise<CompletionContract | undefined>;
  appendEvent(event: JobEvent): Promise<void>;
  getEvents(jobId: string): Promise<JobEvent[]>;
}

class MemoryJobStore implements JobStore {
  private jobs = new Map<string, CompletionContract>();
  private events = new Map<string, JobEvent[]>();

  async saveJob(job: CompletionContract) {
    this.jobs.set(job.id, job);
  }

  async getJob(id: string) {
    return this.jobs.get(id);
  }

  async appendEvent(event: JobEvent) {
    const events = this.events.get(event.jobId) ?? [];
    events.push(event);
    this.events.set(event.jobId, events);
  }

  async getEvents(jobId: string) {
    return this.events.get(jobId) ?? [];
  }
}

class FileJobStore implements JobStore {
  private jobsDir: string;
  private eventsDir: string;

  constructor(root = env.signoffStateDir ?? (existsSync("/opt/signoff") ? "/opt/signoff/state" : "/private/tmp/signoff-state")) {
    this.jobsDir = join(root, "jobs");
    this.eventsDir = join(root, "events");
  }

  private async ensureDirs() {
    await mkdir(this.jobsDir, { recursive: true });
    await mkdir(this.eventsDir, { recursive: true });
  }

  private jobPath(id: string) {
    return join(this.jobsDir, `${id}.json`);
  }

  private eventPath(jobId: string) {
    return join(this.eventsDir, `${jobId}.json`);
  }

  async saveJob(job: CompletionContract) {
    await this.ensureDirs();
    await writeFile(this.jobPath(job.id), `${JSON.stringify(job, null, 2)}\n`, "utf8");
  }

  async getJob(id: string) {
    try {
      const raw = await readFile(this.jobPath(id), "utf8");
      return JSON.parse(raw) as CompletionContract;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  async appendEvent(event: JobEvent) {
    await this.ensureDirs();
    let events: JobEvent[] = [];
    try {
      events = JSON.parse(await readFile(this.eventPath(event.jobId), "utf8")) as JobEvent[];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    events.push(event);
    await writeFile(this.eventPath(event.jobId), `${JSON.stringify(events, null, 2)}\n`, "utf8");
  }

  async getEvents(jobId: string) {
    try {
      return JSON.parse(await readFile(this.eventPath(jobId), "utf8")) as JobEvent[];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }
}

class RedisJobStore implements JobStore {
  private client: RedisClientType;
  private connected = false;

  constructor(url: string) {
    this.client = createClient({ url });
  }

  private async connect() {
    if (!this.connected) {
      await this.client.connect();
      this.connected = true;
    }
  }

  async saveJob(job: CompletionContract) {
    await this.connect();
    await this.client.set(`job:${job.id}`, JSON.stringify(job));
  }

  async getJob(id: string) {
    await this.connect();
    const raw = await this.client.get(`job:${id}`);
    return raw ? (JSON.parse(raw) as CompletionContract) : undefined;
  }

  async appendEvent(event: JobEvent) {
    await this.connect();
    await this.client.xAdd(`job:${event.jobId}:events`, "*", {
      payload: JSON.stringify(event),
    });
  }

  async getEvents(jobId: string) {
    await this.connect();
    const entries = await this.client.xRange(`job:${jobId}:events`, "-", "+");
    return entries.flatMap((entry) => {
      const payload = entry.message.payload;
      return payload ? [JSON.parse(payload) as JobEvent] : [];
    });
  }
}

export const store: JobStore = env.redisUrl
  ? new RedisJobStore(env.redisUrl)
  : new FileJobStore();
