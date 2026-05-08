import { IsIn } from "class-validator";

export class VoteDto {
  @IsIn(["yes", "no"])
  vote!: "yes" | "no";
}
