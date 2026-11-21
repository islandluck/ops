ALTER TABLE "fundraise_investors" ALTER COLUMN "check_amount_cents" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "fundraise_rounds" ALTER COLUMN "target_amount_cents" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "fundraise_rounds" ALTER COLUMN "valuation_cents" SET DATA TYPE bigint;