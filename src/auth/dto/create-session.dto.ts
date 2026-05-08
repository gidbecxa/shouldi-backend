import { IsString, MinLength } from "class-validator";

export class CreateSessionDto {
  @IsString()
  @MinLength(8)
  device_id!: string;
}
