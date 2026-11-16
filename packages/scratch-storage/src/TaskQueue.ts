export interface QueueOptions {
    burstLimit: number;
    sustainRate: number;
    startingTokens?: number;
    queueCostLimit?: number;
    concurrency?: number;
}

interface TaskRecord {
    task: () => unknown;
    cost: number;
    resolve: (value: unknown) => void;
    reject: (reason?: unknown) => void;
}

export class TaskQueue {
    private readonly burstLimit: number;
    private readonly sustainRate: number;
    private readonly queueCostLimit: number;
    private readonly concurrencyLimit: number;
    private readonly pending: TaskRecord[] = [];
    private tokens: number;
    private running = 0;
    private lastRefill = Date.now();
    private timer: ReturnType<typeof setTimeout> | null = null;

    constructor(options: QueueOptions) {
        this.burstLimit = options.burstLimit;
        this.sustainRate = options.sustainRate;
        this.queueCostLimit = options.queueCostLimit ?? Infinity;
        this.concurrencyLimit = options.concurrency ?? 1;
        this.tokens = options.startingTokens ?? options.burstLimit;
    }

    do<T>(task: () => T | Promise<T>, cost = 1): Promise<T> {
        const queuedCost = this.pending.reduce((total, record) => total + record.cost, 0);
        if (queuedCost + cost > this.queueCostLimit) {
            return Promise.reject(new Error(`queue cost limit exceeded: ${this.queueCostLimit}`));
        }
        return new Promise<T>((resolve, reject) => {
            this.pending.push({task, cost, resolve: resolve as (value: unknown) => void, reject});
            this.runTasks();
        });
    }

    private refill(): void {
        const now = Date.now();
        this.tokens = Math.min(
            this.burstLimit,
            this.tokens + ((now - this.lastRefill) / 1000) * this.sustainRate
        );
        this.lastRefill = now;
    }

    private runTasks(): void {
        while (this.running < this.concurrencyLimit && this.pending.length > 0) {
            const next = this.pending[0];
            this.refill();
            if (this.tokens < next.cost) {
                const wait = ((next.cost - this.tokens) / this.sustainRate) * 1000;
                if (this.timer === null) {
                    this.timer = setTimeout(() => {
                        this.timer = null;
                        this.runTasks();
                    }, Math.max(1, Math.ceil(wait)));
                }
                return;
            }
            this.pending.shift();
            this.tokens -= next.cost;
            this.running += 1;
            Promise.resolve()
                .then(next.task)
                .then(next.resolve, next.reject)
                .finally(() => {
                    this.running -= 1;
                    this.runTasks();
                });
        }
    }
}

export class QueueManager<T = string> {
    private readonly queues = new Map<T, TaskQueue>();

    constructor(private readonly defaultOptions: QueueOptions) {}

    create(id: T, overrides: Partial<QueueOptions> = {}): TaskQueue {
        const queue = new TaskQueue({...this.defaultOptions, ...overrides});
        this.queues.set(id, queue);
        return queue;
    }

    getOrCreate(id: T, overrides: Partial<QueueOptions> = {}): TaskQueue {
        return this.queues.get(id) ?? this.create(id, overrides);
    }
}
