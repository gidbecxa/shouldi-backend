import { IsIn } from "class-validator";

export class UpdateQuestionStatusDto {
  @IsIn(["approved", "deleted"])
  status!: "approved" | "deleted";
}
