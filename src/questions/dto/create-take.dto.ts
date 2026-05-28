import { IsString, MaxLength, MinLength } from "class-validator";

export class CreateTakeDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  content!: string;
}
