using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace KubeSpoke.Server.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddRecycleBin : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "DeletedObjects",
                columns: table => new
                {
                    Id = table.Column<long>(type: "INTEGER", nullable: false)
                        .Annotation("Sqlite:Autoincrement", true),
                    TimeUtc = table.Column<DateTime>(type: "TEXT", nullable: false),
                    Actor = table.Column<string>(type: "TEXT", nullable: false),
                    Cluster = table.Column<string>(type: "TEXT", nullable: false),
                    Namespace = table.Column<string>(type: "TEXT", nullable: false),
                    Kind = table.Column<string>(type: "TEXT", nullable: false),
                    Name = table.Column<string>(type: "TEXT", nullable: false),
                    Group = table.Column<string>(type: "TEXT", nullable: false),
                    Version = table.Column<string>(type: "TEXT", nullable: false),
                    Plural = table.Column<string>(type: "TEXT", nullable: false),
                    Yaml = table.Column<string>(type: "TEXT", nullable: false),
                    ExpiresUtc = table.Column<DateTime>(type: "TEXT", nullable: false),
                    RestoredUtc = table.Column<DateTime>(type: "TEXT", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_DeletedObjects", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_DeletedObjects_ExpiresUtc",
                table: "DeletedObjects",
                column: "ExpiresUtc");

            migrationBuilder.CreateIndex(
                name: "IX_DeletedObjects_TimeUtc",
                table: "DeletedObjects",
                column: "TimeUtc");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "DeletedObjects");
        }
    }
}
