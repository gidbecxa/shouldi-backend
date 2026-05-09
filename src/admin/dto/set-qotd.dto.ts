import { IsUUID } from "class-validator";

export class SetQotdDto {
  @IsUUID()
  question_id!: string;
}
