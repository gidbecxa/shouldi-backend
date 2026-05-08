import { IsOptional, IsString, MinLength } from "class-validator";

export class GoogleSignInDto {
  @IsString()
  @MinLength(20)
  id_token!: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  device_id?: string;
}
