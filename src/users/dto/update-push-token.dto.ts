import { IsString, MinLength } from "class-validator";

export class UpdatePushTokenDto {
  @IsString()
  @MinLength(10)
  push_token!: string;
}
