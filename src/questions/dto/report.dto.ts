import { IsIn } from "class-validator";

export class ReportDto {
  @IsIn(["harmful", "inappropriate", "spam", "personal_attack"])
  reason!: "harmful" | "inappropriate" | "spam" | "personal_attack";
}
