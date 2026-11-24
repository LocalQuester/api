-- 기존 티켓은 브라우저 검증값이 없어 사용할 수 없으므로 폐기합니다.
-- 배포 시 티켓 발급을 잠시 중단한 상태에서 실행합니다.
DELETE FROM "login_tickets";
--> statement-breakpoint
ALTER TABLE "login_tickets" ADD COLUMN "challenge" text NOT NULL;
